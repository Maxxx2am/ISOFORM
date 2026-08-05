const { withEntitlementsPlist } = require('@expo/config-plugins');

/** Local reminders use UserNotifications but do not need APNs push capability. */
module.exports = function withoutPushNotifications(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
