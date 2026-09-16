<?php
/**
 * Removes everything Mail Canary stored.
 *
 * Runs only when the plugin is deleted, not on deactivation.
 *
 * @package MailCanary
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Remove everything this plugin stored on the current site.
 *
 * The rate limiter writes a short-lived, time-bucketed option, so those are cleared by
 * prefix rather than by name.
 *
 * @return void
 */
function mail_canary_purge_site() {
	global $wpdb;

	delete_option( 'mail_canary_token' );
	delete_option( 'mail_canary_destination' );
	delete_option( 'mail_canary_last' );

	// Left over from 1.0.0, which rate limited with a transient.
	delete_transient( 'mail_canary_cooldown' );

	$slots = $wpdb->get_col(
		"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE 'mail\_canary\_slot\_%'"
	);

	foreach ( $slots as $slot ) {
		delete_option( $slot );
	}
}

mail_canary_purge_site();

// Multisite: same cleanup on every site in the network.
if ( is_multisite() ) {
	$sites = get_sites( array( 'fields' => 'ids', 'number' => 0 ) );

	foreach ( $sites as $site_id ) {
		switch_to_blog( $site_id );
		mail_canary_purge_site();
		restore_current_blog();
	}
}
