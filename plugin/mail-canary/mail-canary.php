<?php
/**
 * Plugin Name:       Mail Canary
 * Plugin URI:        https://github.com/wpmudev/mail-canary
 * Description:       Lets an external monitor confirm this site's email is actually being delivered, not just handed off. An experiment from WPMU DEV, shared as a starting point.
 * Version:           1.1.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            WPMU DEV Experiments
 * Author URI:        https://wpmudev.com/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       mail-canary
 *
 * The site never initiates contact. A monitor calls in, this plugin sends a heartbeat
 * through wp_mail() and reports what happened locally. The monitor then checks whether
 * that exact heartbeat arrived.
 *
 * @package MailCanary
 */

defined( 'ABSPATH' ) || exit;

define( 'MAIL_CANARY_VERSION', '1.1.0' );
define( 'MAIL_CANARY_NS', 'mail-canary/v1' );

/**
 * Minimum seconds between heartbeats.
 *
 * Without this, anyone holding the token could call the endpoint in a loop and make the
 * site send unlimited email — exhausting an SMTP quota or getting the sending domain
 * flagged. The token is the gate; this is the blast radius.
 */
define( 'MAIL_CANARY_COOLDOWN', 60 );

/* -------------------------------------------------------------------------
 * Options
 * ---------------------------------------------------------------------- */

/**
 * Access token, generated on first use.
 *
 * @return string
 */
function mail_canary_token() {
	$token = get_option( 'mail_canary_token' );

	if ( ! $token ) {
		$token = wp_generate_password( 32, false, false );
		update_option( 'mail_canary_token', $token, false );
	}

	return $token;
}

/**
 * Discard the current token and issue a new one.
 *
 * @return string
 */
function mail_canary_rotate_token() {
	$token = wp_generate_password( 32, false, false );
	update_option( 'mail_canary_token', $token, false );

	return $token;
}

/**
 * Address heartbeats are sent to.
 *
 * @return string
 */
function mail_canary_destination() {
	return trim( (string) get_option( 'mail_canary_destination', '' ) );
}

/**
 * Endpoint URL, with no credential in it.
 *
 * @return string
 */
function mail_canary_endpoint_url() {
	return rest_url( MAIL_CANARY_NS . '/ping' );
}

/**
 * Setup URL, token included.
 *
 * This is a one-time handoff: the monitor reads the token out of it, stores it, and from
 * then on sends it in a request header. The token never travels in a URL again, which is
 * the part that matters, because a URL is what ends up in the access log.
 *
 * @return string
 */
function mail_canary_ping_url() {
	return add_query_arg( 'token', mail_canary_token(), mail_canary_endpoint_url() );
}

/**
 * Find the caller's token, and note how it got here.
 *
 * A header is the only one of the three that does not end up written to this site's
 * access log on every single check.
 *
 * @param WP_REST_Request $request Request object.
 * @return array
 */
function mail_canary_read_token( WP_REST_Request $request ) {
	$header = $request->get_header( 'x_mail_canary_token' );
	if ( is_string( $header ) && '' !== trim( $header ) ) {
		return array( 'token' => trim( $header ), 'via' => 'header' );
	}

	// JSON and form bodies land in different places. get_body_params() holds only
	// form-encoded fields, so a JSON client checked with that alone gets a 403.
	$json = $request->get_json_params();
	if ( is_array( $json ) && isset( $json['token'] ) && is_string( $json['token'] ) && '' !== $json['token'] ) {
		return array( 'token' => $json['token'], 'via' => 'body' );
	}

	$body = $request->get_body_params();
	if ( isset( $body['token'] ) && is_string( $body['token'] ) && '' !== $body['token'] ) {
		return array( 'token' => $body['token'], 'via' => 'body' );
	}

	$query = $request->get_query_params();
	if ( isset( $query['token'] ) && is_string( $query['token'] ) && '' !== $query['token'] ) {
		return array( 'token' => $query['token'], 'via' => 'query' );
	}

	return array( 'token' => '', 'via' => 'none' );
}

/**
 * Claim the right to send one heartbeat, or refuse.
 *
 * Deliberately not get_transient() then set_transient(). That reads, decides, then
 * writes, with nothing stopping a dozen concurrent requests all reading "no cooldown"
 * and all sending. This rate limit is the only thing between a leaked token and somebody
 * burning through the site's sending quota, so it has to actually hold.
 *
 * add_option() is atomic: option_name carries a unique index, so exactly one caller can
 * insert a given key and the database refuses the rest. Time is bucketed so the key
 * changes on its own and nothing has to expire it.
 *
 * @return array
 */
function mail_canary_claim_send_slot() {
	$now    = time();
	$bucket = (int) floor( $now / MAIL_CANARY_COOLDOWN );
	$key    = 'mail_canary_slot_' . $bucket;

	if ( add_option( $key, $now, '', 'no' ) ) {
		// Won it. Tidy up the previous bucket so these never accumulate.
		delete_option( 'mail_canary_slot_' . ( $bucket - 1 ) );

		return array( 'allowed' => true, 'retry_after' => 0 );
	}

	$next = ( $bucket + 1 ) * MAIL_CANARY_COOLDOWN;

	return array( 'allowed' => false, 'retry_after' => max( 1, $next - $now ) );
}

/* -------------------------------------------------------------------------
 * Capture what actually happened during wp_mail()
 * ---------------------------------------------------------------------- */

/**
 * Last wp_mail() error message, or null.
 *
 * @var string|null
 */
$GLOBALS['mail_canary_error'] = null;

/**
 * SMTP host used for the last send, or null.
 *
 * @var string|null
 */
$GLOBALS['mail_canary_host'] = null;

add_action(
	'wp_mail_failed',
	function ( $wp_error ) {
		if ( is_wp_error( $wp_error ) ) {
			$GLOBALS['mail_canary_error'] = $wp_error->get_error_message();
		}
	}
);

// Late priority so mail plugins have finished configuring PHPMailer.
add_action(
	'phpmailer_init',
	function ( $phpmailer ) {
		if ( ! empty( $phpmailer->Mailer ) && 'smtp' === $phpmailer->Mailer && ! empty( $phpmailer->Host ) ) {
			$GLOBALS['mail_canary_host'] = $phpmailer->Host;
		}
	},
	9999
);

/**
 * Which mail plugin is in charge. Best effort — the point is to give a human a starting
 * place, not to be exhaustive.
 *
 * @return string
 */
function mail_canary_detect_mailer() {
	$found = array();

	if ( defined( 'WPMS_PLUGIN_VER' ) || class_exists( 'WPMailSMTP\Core' ) ) {
		$found[] = 'WP Mail SMTP';
	}
	if ( defined( 'FLUENTMAIL_PLUGIN_VERSION' ) || class_exists( 'FluentMail\App\Application' ) ) {
		$found[] = 'FluentSMTP';
	}
	if ( class_exists( 'PostmanOptions' ) ) {
		$found[] = 'Post SMTP';
	}
	if ( class_exists( 'EasyWPSMTP' ) || defined( 'EASY_WP_SMTP_VERSION' ) ) {
		$found[] = 'Easy WP SMTP';
	}
	if ( defined( 'MAILGUN_VERSION' ) ) {
		$found[] = 'Mailgun';
	}
	if ( defined( 'SENDGRID_PLUGIN_VERSION' ) ) {
		$found[] = 'SendGrid';
	}

	if ( empty( $found ) ) {
		return 'none detected (PHP mail())';
	}

	return implode( ' + ', $found );
}

/* -------------------------------------------------------------------------
 * REST API
 * ---------------------------------------------------------------------- */

add_action(
	'rest_api_init',
	function () {
		$auth = function ( WP_REST_Request $request ) {
			$found = mail_canary_read_token( $request );
			$given = $found['token'];
			$real  = mail_canary_token();

			// Recorded so the response can tell the monitor when it is still using the
			// old, noisier path and ought to be updated.
			$GLOBALS['mail_canary_token_via'] = $found['via'];

			if ( '' === $given || ! hash_equals( $real, $given ) ) {
				return new WP_Error(
					'mail_canary_forbidden',
					__( 'Invalid token.', 'mail-canary' ),
					array( 'status' => 403 )
				);
			}

			return true;
		};

		register_rest_route(
			MAIL_CANARY_NS,
			'/ping',
			array(
				'methods'             => array( 'GET', 'POST' ),
				'permission_callback' => $auth,
				'callback'            => 'mail_canary_ping',
				// No declared 'token' arg on purpose. Marking one required here would
				// reject header-authenticated calls, which are the ones worth having.
			)
		);

		register_rest_route(
			MAIL_CANARY_NS,
			'/status',
			array(
				'methods'             => 'GET',
				'permission_callback' => $auth,
				'callback'            => 'mail_canary_status',
			)
		);
	}
);

/**
 * Send one heartbeat and report exactly what happened.
 *
 * The ID is unique per ping and appears in the subject, so a monitor watching one
 * mailbox for many sites can tell which site a heartbeat came from AND whether it is
 * the current ping or a stale one from an earlier run.
 *
 * @param WP_REST_Request $request Request object.
 * @return WP_REST_Response
 */
function mail_canary_ping( $request ) {
	return mail_canary_send_heartbeat( false );
}

/**
 * Do the actual send.
 *
 * @param bool $bypass_rate_limit True only for the admin's own test button, which is
 *                               already behind a capability check and a nonce.
 * @return WP_REST_Response
 */
function mail_canary_send_heartbeat( $bypass_rate_limit = false ) {
	$destination = mail_canary_destination();

	if ( ! $destination || ! is_email( $destination ) ) {
		return new WP_REST_Response(
			array(
				'ok'    => false,
				'error' => __( 'No destination address configured. Set one in Settings, Mail Canary.', 'mail-canary' ),
			),
			400
		);
	}

	// Rate limit. A valid token must not mean unlimited sends.
	if ( ! $bypass_rate_limit ) {
		$slot = mail_canary_claim_send_slot();

		if ( ! $slot['allowed'] ) {
			$response = new WP_REST_Response(
				array(
					'ok'          => false,
					'error'       => __( 'Rate limited. Only one heartbeat per minute.', 'mail-canary' ),
					'retry_after' => $slot['retry_after'],
				),
				429
			);
			$response->header( 'Retry-After', $slot['retry_after'] );

			return $response;
		}
	}

	$host = wp_parse_url( home_url(), PHP_URL_HOST );
	$slug = preg_replace( '/[^a-z0-9]+/', '-', strtolower( (string) $host ) );
	$id   = sprintf( 'mc-%s-%d-%s', $slug, time(), wp_generate_password( 6, false, false ) );

	$GLOBALS['mail_canary_error'] = null;
	$GLOBALS['mail_canary_host']  = null;

	/* translators: 1: site host, 2: unique heartbeat id */
	$subject = sprintf( '[Mail Canary] %1$s %2$s', $host, $id );

	$body = implode(
		"\n",
		array(
			__( 'Automated delivery check. Nothing to action.', 'mail-canary' ),
			'',
			'Site: ' . home_url(),
			'ID:   ' . $id,
			'Sent: ' . gmdate( 'c' ),
		)
	);

	$sent = wp_mail( $destination, $subject, $body, array( 'X-Mail-Canary-Id: ' . $id ) );

	$result = array(
		'ok'               => true,
		'id'               => $id,
		'site'             => $host,
		'home_url'         => home_url(),
		'destination'      => $destination,
		'wp_mail_returned' => (bool) $sent,
		'error'            => $GLOBALS['mail_canary_error'],
		'mailer'           => mail_canary_detect_mailer(),
		'smtp_host'        => $GLOBALS['mail_canary_host'],
		'sent_at'          => gmdate( 'c' ),
		'plugin_version'   => MAIL_CANARY_VERSION,
		// True when the caller sent its token in the query string, which writes the
		// credential into this site's access log on every check. Nothing reads
		// admin_email here any more; the monitor never used it, and handing out the
		// site owner's address to anyone holding the token bought nothing.
		'token_in_url'     => 'query' === ( isset( $GLOBALS['mail_canary_token_via'] ) ? $GLOBALS['mail_canary_token_via'] : '' ),
	);

	update_option( 'mail_canary_last', $result, false );

	return new WP_REST_Response( $result, 200 );
}

/**
 * Report the last attempt without sending anything.
 *
 * @param WP_REST_Request $request Request object.
 * @return WP_REST_Response
 */
function mail_canary_status( $request ) {
	$last = get_option( 'mail_canary_last' );

	return new WP_REST_Response(
		array(
			'ok'             => true,
			'site'           => wp_parse_url( home_url(), PHP_URL_HOST ),
			'destination'    => mail_canary_destination(),
			'mailer'         => mail_canary_detect_mailer(),
			'plugin_version' => MAIL_CANARY_VERSION,
			'last'           => $last ? $last : null,
		),
		200
	);
}

/* -------------------------------------------------------------------------
 * Settings screen
 * ---------------------------------------------------------------------- */

add_action(
	'admin_menu',
	function () {
		add_options_page(
			__( 'Mail Canary', 'mail-canary' ),
			__( 'Mail Canary', 'mail-canary' ),
			'manage_options',
			'mail-canary',
			'mail_canary_settings_page'
		);
	}
);

add_action(
	'admin_init',
	function () {
		register_setting(
			'mail_canary',
			'mail_canary_destination',
			array(
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_email',
				'default'           => '',
				'show_in_rest'      => false,
			)
		);
	}
);

/**
 * Render the settings screen.
 *
 * @return void
 */
function mail_canary_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	$notice = '';

	// Rotate token.
	if ( isset( $_POST['mail_canary_rotate'] ) && check_admin_referer( 'mail_canary_rotate' ) ) {
		mail_canary_rotate_token();
		$notice = '<div class="notice notice-warning"><p><strong>' .
			esc_html__( 'New token issued.', 'mail-canary' ) . '</strong> ' .
			esc_html__( 'The old one stopped working immediately. Copy the new command below and paste it into your monitor, or this site will stop being checked.', 'mail-canary' ) .
			'</p></div>';
	}

	$destination = mail_canary_destination();
	$last        = get_option( 'mail_canary_last' );

	// Send a test.
	if ( isset( $_POST['mail_canary_test'] ) && check_admin_referer( 'mail_canary_test' ) ) {
		// Bypasses the rate limit for this one send. It used to clear the limit
		// outright, which also handed a free send to anyone else holding the token.
		$data = mail_canary_send_heartbeat( true )->get_data();
		$last = get_option( 'mail_canary_last' );

		if ( ! empty( $data['wp_mail_returned'] ) ) {
			$notice = '<div class="notice notice-success"><p><strong>' .
				esc_html__( 'WordPress sent it.', 'mail-canary' ) . '</strong> ' .
				sprintf(
					/* translators: 1: destination email, 2: heartbeat id */
					esc_html__( 'Now check %1$s for a message with ID %2$s.', 'mail-canary' ),
					'<code>' . esc_html( $destination ) . '</code>',
					'<code>' . esc_html( $data['id'] ) . '</code>'
				) .
				'<br>' . esc_html__( 'If it never arrives, WordPress is handing your email off to something that is losing it. That is exactly the problem this plugin exists to catch.', 'mail-canary' ) .
				'</p></div>';
		} else {
			$notice = '<div class="notice notice-error"><p><strong>' .
				esc_html__( 'WordPress could not send it.', 'mail-canary' ) . '</strong><br>' .
				esc_html__( 'Error:', 'mail-canary' ) . ' <code>' .
				esc_html( ! empty( $data['error'] ) ? $data['error'] : __( 'wp_mail() returned false with no error message.', 'mail-canary' ) ) .
				'</code><br>' . esc_html__( 'Mailer:', 'mail-canary' ) . ' <code>' .
				esc_html( isset( $data['mailer'] ) ? $data['mailer'] : 'unknown' ) . '</code><br>' .
				esc_html__( 'This site cannot currently send any email at all, including contact form notifications and WooCommerce order confirmations.', 'mail-canary' ) .
				'</p></div>';
		}
	}

	$mailer = mail_canary_detect_mailer();
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Mail Canary', 'mail-canary' ); ?></h1>

		<p style="max-width:46em;font-size:14px;">
			<?php esc_html_e( 'WordPress email fails silently. A key gets rotated, a sending limit is hit, and contact form notifications simply stop arriving with no error anywhere. Mail Canary lets an outside monitor prove your email is genuinely being delivered, not just accepted by WordPress and lost afterwards.', 'mail-canary' ); ?>
		</p>

		<?php echo wp_kses_post( $notice ); ?>

		<div style="max-width:46em;">

			<!-- Current state -->
			<div style="background:#fff;border:1px solid #c3c4c7;border-left-width:4px;border-left-color:<?php echo $destination ? '#00a32a' : '#dba617'; ?>;padding:12px 16px;margin:20px 0;">
				<strong><?php echo $destination ? esc_html__( 'Ready', 'mail-canary' ) : esc_html__( 'Not set up yet', 'mail-canary' ); ?></strong><br>
				<span style="color:#50575e;">
					<?php if ( $destination ) : ?>
						<?php
						printf(
							/* translators: %s: destination email address */
							esc_html__( 'Heartbeats go to %s.', 'mail-canary' ),
							'<code>' . esc_html( $destination ) . '</code>'
						);
						?>
						<?php if ( ! empty( $last['sent_at'] ) ) : ?>
							<br><?php
							printf(
								/* translators: %s: human readable time difference */
								esc_html__( 'Last heartbeat sent %s ago.', 'mail-canary' ),
								esc_html( human_time_diff( strtotime( $last['sent_at'] ) ) )
							);
							?>
						<?php else : ?>
							<br><?php esc_html_e( 'No heartbeat sent yet. Use the test button below.', 'mail-canary' ); ?>
						<?php endif; ?>
					<?php else : ?>
						<?php esc_html_e( 'Add the address your monitor watches, below.', 'mail-canary' ); ?>
					<?php endif; ?>
					<br><?php
					printf(
						/* translators: %s: detected mail plugin name */
						esc_html__( 'Mail on this site is handled by: %s', 'mail-canary' ),
						'<code>' . esc_html( $mailer ) . '</code>'
					);
					?>
				</span>
			</div>

			<!-- Step 1 -->
			<h2 style="margin-top:28px;"><?php esc_html_e( '1. Where heartbeats are sent', 'mail-canary' ); ?></h2>
			<p class="description" style="font-size:13px;">
				<?php esc_html_e( 'Every time your monitor asks, this site sends one small email to this address. Give it a dedicated mailbox that your monitor can read, not a client address and not your normal inbox. It will collect a few automated messages a day and nothing else.', 'mail-canary' ); ?>
			</p>

			<form method="post" action="options.php">
				<?php settings_fields( 'mail_canary' ); ?>
				<input name="mail_canary_destination" id="mail_canary_destination" type="email"
					class="regular-text" value="<?php echo esc_attr( $destination ); ?>"
					placeholder="canary@youragency.com" required style="max-width:24em;">
				<?php submit_button( __( 'Save address', 'mail-canary' ), 'primary', 'submit', false ); ?>
			</form>

			<?php if ( $destination ) : ?>

				<!-- Step 2 -->
				<h2 style="margin-top:32px;"><?php esc_html_e( '2. Connect your monitor', 'mail-canary' ); ?></h2>
				<p class="description" style="font-size:13px;">
					<?php esc_html_e( 'Copy this line and paste it into OpenClaw. It tells your monitor where this site is and gives it permission to ask for a heartbeat.', 'mail-canary' ); ?>
				</p>

				<div style="display:flex;gap:8px;align-items:flex-start;margin:12px 0;">
					<input type="text" id="mail-canary-cmd" readonly
						value="/mail-canary add <?php echo esc_attr( mail_canary_ping_url() ); ?>"
						style="flex:1;font-family:Consolas,Monaco,monospace;font-size:12px;padding:8px;background:#f6f7f7;">
					<button type="button" class="button button-primary" id="mail-canary-copy" style="white-space:nowrap;">
						<?php esc_html_e( 'Copy', 'mail-canary' ); ?>
					</button>
				</div>

				<p class="description" style="font-size:13px;">
					<strong><?php esc_html_e( 'Treat that line like a password.', 'mail-canary' ); ?></strong>
					<?php esc_html_e( 'It contains an access token. Anyone who has it can make this site send a heartbeat, though not read anything or change anything.', 'mail-canary' ); ?>
					<?php esc_html_e( 'This is the only time the token appears in a web address. Your monitor reads it out, stores it, and from then on sends it in a request header, so it never gets written into the access log for this site.', 'mail-canary' ); ?>
				</p>

				<!-- Step 3 -->
				<h2 style="margin-top:32px;"><?php esc_html_e( '3. Test it now', 'mail-canary' ); ?></h2>
				<p class="description" style="font-size:13px;">
					<?php esc_html_e( 'Sends one heartbeat immediately so you can confirm it arrives. Worth doing once after setup, and any time you change your mail settings.', 'mail-canary' ); ?>
				</p>
				<form method="post">
					<?php wp_nonce_field( 'mail_canary_test' ); ?>
					<p><button class="button button-secondary" name="mail_canary_test" value="1">
						<?php esc_html_e( 'Send a test heartbeat', 'mail-canary' ); ?>
					</button></p>
				</form>

				<!-- Security -->
				<h2 style="margin-top:32px;"><?php esc_html_e( 'Security', 'mail-canary' ); ?></h2>

				<p class="description" style="font-size:13px;">
					<strong><?php esc_html_e( 'Rate limit.', 'mail-canary' ); ?></strong>
					<?php
					printf(
						/* translators: %d: cooldown in seconds */
						esc_html__( 'This site will only send one heartbeat every %d seconds. Even if the token above leaked, nobody could use it to send email repeatedly and burn through your sending quota. Your monitor only asks once a day, so it never notices the limit.', 'mail-canary' ),
						(int) MAIL_CANARY_COOLDOWN
					);
					?>
				</p>

				<p class="description" style="font-size:13px;margin-top:14px;">
					<strong><?php esc_html_e( 'New token.', 'mail-canary' ); ?></strong>
					<?php esc_html_e( 'Throws away the current token and issues a fresh one, in case the line above was shared somewhere it should not have been. The old token stops working straight away, so you will need to copy the new command to your monitor or this site stops being checked.', 'mail-canary' ); ?>
				</p>

				<form method="post" onsubmit="return confirm('<?php echo esc_js( __( 'Issue a new token? Your monitor will stop checking this site until you give it the new command.', 'mail-canary' ) ); ?>');">
					<?php wp_nonce_field( 'mail_canary_rotate' ); ?>
					<p><button class="button" name="mail_canary_rotate" value="1">
						<?php esc_html_e( 'Issue a new token', 'mail-canary' ); ?>
					</button></p>
				</form>

			<?php endif; ?>
		</div>
	</div>

	<?php if ( $destination ) : ?>
	<script>
	( function () {
		var btn   = document.getElementById( 'mail-canary-copy' );
		var field = document.getElementById( 'mail-canary-cmd' );
		if ( ! btn || ! field ) { return; }

		var original = btn.textContent;

		btn.addEventListener( 'click', function () {
			var done = function () {
				btn.textContent = <?php echo wp_json_encode( __( 'Copied', 'mail-canary' ) ); ?>;
				setTimeout( function () { btn.textContent = original; }, 1800 );
			};

			// Clipboard API needs a secure context; fall back to selecting the text.
			if ( navigator.clipboard && window.isSecureContext ) {
				navigator.clipboard.writeText( field.value ).then( done, function () {
					field.select();
					document.execCommand( 'copy' );
					done();
				} );
			} else {
				field.select();
				field.setSelectionRange( 0, 99999 );
				document.execCommand( 'copy' );
				done();
			}
		} );
	}() );
	</script>
	<?php endif; ?>
	<?php
}
