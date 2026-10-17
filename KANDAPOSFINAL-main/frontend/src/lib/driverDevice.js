// Phone-side features of the Kanda Driver app: GPS sharing while online,
// notification permission, local "new delivery" notifications and FCM push
// registration. Native (Capacitor) on the Android app; falls back to the
// browser's geolocation / Notification APIs when the driver screen is used
// on the web (/:slug/driver), where nothing works in the background.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";

const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");
const native = () => Capacitor.isNativePlatform();
const has = (name) => native() && Capacitor.isPluginAvailable(name);

// Don't send a fix more often than this, even when the phone reports
// faster — enough for a smooth customer map without draining the battery.
const MIN_SEND_MS = 10000;

/** Start sharing GPS. `onFix({lat,lng,accuracy,heading,speed})` gets each
 *  throttled fix; `onError(code)` gets "denied" or "unavailable". Returns a
 *  stop function. */
export async function startLocationSharing(onFix, onError) {
  let last = 0;
  const emit = (fix) => {
    const now = Date.now();
    if (now - last < MIN_SEND_MS) return;
    last = now;
    onFix(fix);
  };

  if (has("BackgroundGeolocation")) {
    let id = null;
    try {
      id = await BackgroundGeolocation.addWatcher(
        {
          // A visible notification keeps Android delivering fixes while the
          // phone is locked or the driver is in Google Maps.
          backgroundTitle: "Sharing your location",
          backgroundMessage: "Customers can see where their delivery is while you're online.",
          requestPermissions: true,
          stale: false,
          distanceFilter: 15,
        },
        (loc, err) => {
          if (err) {
            onError?.(err.code === "NOT_AUTHORIZED" ? "denied" : "unavailable");
            return;
          }
          if (loc) emit({ lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy, heading: loc.bearing, speed: loc.speed });
        },
      );
    } catch {
      onError?.("unavailable");
    }
    return () => { if (id) BackgroundGeolocation.removeWatcher({ id }).catch(() => {}); };
  }

  if (!navigator.geolocation) {
    onError?.("unavailable");
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => emit({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed }),
    (e) => onError?.(e.code === 1 ? "denied" : "unavailable"),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export function openLocationSettings() {
  if (has("BackgroundGeolocation")) BackgroundGeolocation.openSettings().catch(() => {});
}

/** Ask for notification permission (Android 13+ needs it at runtime, also
 *  for the location-sharing notification). Returns true when granted. */
export async function ensureNotificationPermission() {
  try {
    if (has("LocalNotifications")) {
      let p = await LocalNotifications.checkPermissions();
      if (p.display !== "granted") p = await LocalNotifications.requestPermissions();
      if (p.display === "granted") {
        await LocalNotifications.createChannel?.({
          id: "deliveries", name: "New deliveries", importance: 5, sound: "default", vibration: true,
        }).catch(() => {});
      }
      return p.display === "granted";
    }
    if (typeof Notification !== "undefined") {
      if (Notification.permission === "default") await Notification.requestPermission();
      return Notification.permission === "granted";
    }
  } catch { /* fall through */ }
  return false;
}

let nextId = 1;
/** Show a notification now (works with the app in the background). */
export async function notify(title, body) {
  try {
    if (has("LocalNotifications")) {
      await LocalNotifications.schedule({
        notifications: [{ id: nextId++, title, body, channelId: "deliveries" }],
      });
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      new Notification(title, { body }); // eslint-disable-line no-new
    }
  } catch { /* best effort */ }
}

/** Register for FCM push (alerts when the app is closed). Calls
 *  `onToken(token)` with the device token to send to the backend. A no-op on
 *  the web, and fails quietly when the build has no google-services.json. */
export async function registerPush(onToken) {
  // Only builds that ship a google-services.json can register (see
  // build-android-driver.yml); without Firebase the native call fails.
  if (!has("PushNotifications") || process.env.REACT_APP_FCM_ENABLED !== "true") return;
  try {
    let p = await PushNotifications.checkPermissions();
    if (p.receive !== "granted") p = await PushNotifications.requestPermissions();
    if (p.receive !== "granted") return;
    await PushNotifications.removeAllListeners();
    await PushNotifications.addListener("registration", (t) => onToken(t.value));
    await PushNotifications.addListener("registrationError", () => {});
    await PushNotifications.createChannel?.({
      id: "deliveries", name: "New deliveries", importance: 5, sound: "default", vibration: true,
    }).catch(() => {});
    await PushNotifications.register();
  } catch { /* push not set up for this build */ }
}
