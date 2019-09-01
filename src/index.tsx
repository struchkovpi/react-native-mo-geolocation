// doc strings
// debugging/verbose logging option?

import { Platform, PermissionsAndroid, EmitterSubscription } from 'react-native';
import { Observable, Subscriber } from 'rxjs';
import * as ios from './ios';
import * as android from './android';



/**
 * a geolocation result
 */
export interface GeolocationResult {
  /** timestamp in milliseconds since unix epoch */
  time: number;
  latitude: number;
  longitude: number;
  locationAccuracy: number;
  altitude: number;
  altitudeAccuracy: number;
  course?: number;
  speed?: number;
}



// @TODO: doc
export enum GeolocationAccuracy {
  SIGNIFICANT = 1000,
  LOW = 100,
  MEDIUM = 10,
  HIGH = -1,
  BEST = -2,
}


export enum GeolocationPermissionStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  UNKNOWN = 'unknown',
}


/**
 * geolocation options
 */
export interface GeolocationOptions {
  /**
   * maximum age a cached location may have
   */
  maxAge?: number;
  timeout?: number;
  /**
   * desired accuracy
   */
  accuracy?: GeolocationAccuracy;
  background?: boolean;
  indicateBackground?: boolean;
}



/**
 * any error that occurs during geolocation
 */
export class GeolocationError extends Error {
}



/**
 * Geolocation class
 */
export class Geolocation {
  public static readonly ios = ios;
  public static readonly android = android;

  private static lastResult?: GeolocationResult;
  private static observers: { observer: Subscriber<GeolocationResult>; options: GeolocationOptions; }[] = [];
  private static subscription?: EmitterSubscription;
  private static currentConfig?: ios.Config|android.Config;
  private static verbose: boolean = false;

  public static setVerbose(verbose: boolean) {
    this.verbose = verbose;
    if (Platform.OS === 'ios') {
      ios.Module.setVerbose(verbose);
    } else if (Platform.OS === 'android') {
      android.Module.setVerbose(verbose);
    }
  }

  private static async update() {
    try {
      const active = this.observers.length > 0;
      const background = this.observers.map((i) => i.options.background || false).reduce((a, b) => a || b, false);
      const indicateBackground = this.observers.map((i) => i.options.indicateBackground || false).reduce((a, b) => a || b, false);
      const accuracy = Math.min(...this.observers.map((i) => i.options.accuracy || GeolocationAccuracy.MEDIUM));

      if (this.verbose) console.log(`ReactNativeMoGeolocation.Geolocation.update active=${active} background=${background} indicateBackground=${indicateBackground} accuracy=${accuracy}`);
      // `', active, background, indicateBackground, accuracy, this.observers.map((i) => i.options));

      await this.requestPermissions({ background: background });

      if (Platform.OS === 'ios') {

        if (!this.subscription) {
          this.subscription = ios.Events.addListener('ReactNativeMoGeolocation', (rs) => {
            if (this.verbose) console.log(`ReactNativeMoGeolocation.event`, rs);
            if (rs.type === 'didFailWithError') {
              const error = new GeolocationError(rs.error);
              for (const observer of this.observers) {
                observer.observer.error(error);
              }
            } else if (rs.type === 'didUpdateLocations') {
              const event: GeolocationResult = {
                time: rs.timestamp,
                latitude: rs.coordinate.latitude,
                longitude: rs.coordinate.longitude,
                locationAccuracy: rs.horizontalAccuracy,
                altitude: rs.altitude,
                altitudeAccuracy: rs.verticalAccuracy,
                speed: rs.speed,
                course: rs.course,
                ...{
                  native: rs,
                } as any,
              };
              this.lastResult = event;
              for (const observer of this.observers) {
                observer.observer.next(event);
              }
            }
          });
        }

        const config: ios.Config = {
          desiredAccuracy: active ? accuracy : 0, // 1,
          distanceFilter: active ? Math.max(1, accuracy) : 0,
          activityType: 0,
          allowsBackgroundLocationUpdates: background,
          showsBackgroundLocationIndicator: indicateBackground,
          startUpdatingLocation: active && (accuracy < 1000),
          startMonitoringSignificantLocationChanges: active && (accuracy >= 1000),
        };
        if (JSON.stringify(config) === JSON.stringify(this.currentConfig)) {
          return;
        }
        if (this.verbose) console.log('ReactNativeMoGeolocation.Geolocation.update', config);

        ios.Module.setConfig(config);
        this.currentConfig = config;

      } else if (Platform.OS === 'android') {

        if (!this.subscription) {
          this.subscription = android.Events.addListener('ReactNativeMoGeolocation', (rs) => {
            if (this.verbose) console.log(`ReactNativeMoGeolocation.event`, rs);
            if (rs.type === 'onLocationResult') {
              const event: GeolocationResult = {
                time: rs.time,
                latitude: rs.latitude,
                longitude: rs.longitude,
                locationAccuracy: rs.accuracy,
                altitude: rs.altitude,
                altitudeAccuracy: rs.verticalAccuracy,
                speed: rs.speed,
                course: rs.bearing,
                ...{
                  native: rs,
                } as any,
              };
              this.lastResult = event;
              for (const observer of this.observers) {
                observer.observer.next(event);
              }
            }
          });
        }

        const config: android.Config = {
          priority:
            (accuracy >= 1000) ?
              android.Priority.PRIORITY_NO_POWER :
            (accuracy < 0) ? android.Priority.PRIORITY_HIGH_ACCURACY :
              android.Priority.PRIORITY_BALANCED_POWER_ACCURACY,
          interval: 1000,
          smallestDisplacement: Math.max(0, accuracy),
          requestLocationUpdates: active,
          background: background,
        };
        if (JSON.stringify(config) === JSON.stringify(this.currentConfig)) {
          return;
        }
        if (this.verbose) console.log('ReactNativeMoGeolocation.Geolocation.update', config);

        android.Module.setConfig(config);
        this.currentConfig = config;

      }
    } catch (e) {
      for (const i of this.observers) i.observer.error(e);
      throw e;
    }
  }

  /**
   * get permissions
   * @TODO: unavailable?/disabled?
   */
  public static async getPermissionStatus(args: { background?: boolean } = {}): Promise<GeolocationPermissionStatus> {
    if (Platform.OS === 'ios') {
      const status = await ios.Module.getStatus();
      if (status.authorizationStatus === ios.AuthorizationStatus.Denied) {
        return GeolocationPermissionStatus.DENIED;
      } else if (args.background && status.authorizationStatus !== ios.AuthorizationStatus.AuthorizedAlways) {
        return GeolocationPermissionStatus.DENIED; // UNKNOWN;
      } else if (status.authorizationStatus === ios.AuthorizationStatus.NotDetermined) {
        return GeolocationPermissionStatus.UNKNOWN;
      } else {
        return GeolocationPermissionStatus.GRANTED;
      }

    } else if (Platform.OS === 'android') {
      const res = await PermissionsAndroid.check('android.permission.ACCESS_FINE_LOCATION');
      if (res) return GeolocationPermissionStatus.GRANTED;
      return GeolocationPermissionStatus.DENIED;

    }
    return GeolocationPermissionStatus.GRANTED;
  }

  /**
   * request permissions
   * @TODO: unavailable?/disabled?
   */
  public static async requestPermissions(args: { background?: boolean } = {}): Promise<GeolocationPermissionStatus> {
    if (Platform.OS === 'ios') {
      const status = await ios.Module.getStatus();
      if (args.background && status.backgroundModes.indexOf('location') < 0) {
        throw new GeolocationError('missing location background mode in capabilities');
      }
      const requestAuthorization = async (args: { always: boolean }): Promise<GeolocationPermissionStatus> => {
        const res = new Promise<GeolocationPermissionStatus>((resolve) => {
          let sub: EmitterSubscription|undefined = ios.Events.addListener('ReactNativeMoGeolocation', (rs) => {
            if (rs.type !== 'didChangeAuthorizationStatus') return;
            if (rs.status === ios.AuthorizationStatus.Denied) {
              resolve(GeolocationPermissionStatus.DENIED);
              if (sub) {
                sub.remove();
                sub = undefined;
              }
            } else if (rs.status === ios.AuthorizationStatus.AuthorizedAlways) {
              resolve(GeolocationPermissionStatus.GRANTED);
              if (sub) {
                sub.remove();
                sub = undefined;
              }
            } else if (rs.status === ios.AuthorizationStatus.AuthorizedWhenInUse) {
              if (args.always) {
                resolve(GeolocationPermissionStatus.DENIED);
              } else {
                resolve(GeolocationPermissionStatus.GRANTED);
              }
              if (sub) {
                sub.remove();
                sub = undefined;
              }
            }
          });
        });
        ios.Module.requestAuthorization(args);
        return res;
      };
      if (status.authorizationStatus === ios.AuthorizationStatus.Denied) {
        return GeolocationPermissionStatus.DENIED;
      } else if (args.background && status.authorizationStatus !== ios.AuthorizationStatus.AuthorizedAlways) {
        return await requestAuthorization({ always: true });
      } else if (status.authorizationStatus === ios.AuthorizationStatus.NotDetermined) {
        return await requestAuthorization({ always: false });
      } else {
        return GeolocationPermissionStatus.GRANTED;
      }

    } else if (Platform.OS === 'android') {
      const res = await PermissionsAndroid.request('android.permission.ACCESS_FINE_LOCATION');
      if (res === 'granted') return GeolocationPermissionStatus.GRANTED;
      return GeolocationPermissionStatus.DENIED;

    }
    return GeolocationPermissionStatus.GRANTED;
  }

  /**
   * request permissions
   * @TODO: unavailable?/disabled?
   */
  public static showSettings() {
    if (Platform.OS === 'ios') {
      ios.Module.openSettings();
    } else if (Platform.OS === 'android') {
      android.Module.openSettings();
    }
  }

  /**
   * get the current location once
   * @param options GeolocationOptions
   * @returns GeolocationResult
   */
  public static get(options?: GeolocationOptions): Promise<GeolocationResult> {
    if (this.verbose) console.log(`ReactNativeMoGeolocation.Geolocation.get options=${JSON.stringify(options)}`);
    if (this.lastResult && options && options.maxAge && Date.now() - this.lastResult.time < options.maxAge) {
      return Promise.resolve(this.lastResult);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscription.unsubscribe();
        clearTimeout(timeout);
        reject(new GeolocationError('timeout'));
      }, options && options.timeout || (1000 * 15));
      const subscription = this.observe(options).subscribe({
        next: (value) => {
          subscription.unsubscribe();
          clearTimeout(timeout);
          resolve(value);
        },
        error: (error) => {
          subscription.unsubscribe();
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  /**
   * start observing the location permanently
   * @param options GeolocationOptions
   * @returns rxjs.Observable<GeolocationResult>
   */
  public static observe(options?: GeolocationOptions): Observable<GeolocationResult> {
    return new Observable<GeolocationResult>((observer) => {
      if (this.verbose) console.log(`ReactNativeMoGeolocation.observe.start options=${JSON.stringify(options)}`);
      const item = { observer: observer, options: options || {} };
      this.observers.push(item);
      this.update();
      return () => {
        if (this.verbose) console.log(`ReactNativeMoGeolocation.observe.stop options=${JSON.stringify(options)}`);
        this.observers = this.observers.filter((i) => i !== item);
        this.update();
      };
    });
  }

  /**
   * calculate distance between two coordinates
   * @returns distance in km
   */
  public static getDistance(p1: { latitude: number; longitude: number; }, p2: { latitude: number; longitude: number; }) {
    const deg2rad = (deg: number) => deg * (Math.PI / 180);
    const R = 6371000; // Radius of the earth in m
    const dlat = deg2rad(p2.latitude - p1.latitude);  // deg2rad below
    const dlon = deg2rad(p2.longitude - p1.longitude);
    const a = (
      Math.sin(dlat / 2) * Math.sin(dlat / 2) +
      Math.cos(deg2rad(p1.latitude)) * Math.cos(deg2rad(p2.latitude)) * Math.sin(dlon / 2) * Math.sin(dlon / 2)
    );
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    return d;
  }

  /**
   * calculate bearing/heading between two coordinates
   * @returns bearing in degrees
   */
  public static getBearing(p1: { latitude: number; longitude: number; }, p2: { latitude: number; longitude: number; }) {
    const deg2rad = (deg: number) => deg * (Math.PI / 180);
    const rad2deg = (rad: number) => rad * (180 / Math.PI);
    const y = Math.sin(deg2rad(p2.longitude) - deg2rad(p1.longitude)) * Math.cos(deg2rad(p2.latitude));
    const x = (
      Math.cos(deg2rad(p1.latitude)) * Math.sin(deg2rad(p2.latitude)) -
      Math.sin(deg2rad(p1.latitude)) * Math.cos(deg2rad(p2.latitude)) * Math.cos(deg2rad(p2.longitude) -
      deg2rad(p1.longitude))
    );
    let brng = rad2deg(Math.atan2(y, x));
    if (brng < 0) brng += 360;
    return brng;
  }

}
