export interface BrowserCurrentLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface BrowserLocationRequestOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

type CurrentLocationListener = (location: BrowserCurrentLocation) => void;
type CurrentLocationErrorListener = (message: string, error?: GeolocationPositionError | null) => void;

const defaultLocationRequestOptions: Required<BrowserLocationRequestOptions> = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 60000,
};

export const resolveCurrentLocationErrorMessage = (error?: GeolocationPositionError | null) => {
  if (typeof navigator !== 'undefined' && !navigator.geolocation) {
    return '当前浏览器不支持定位。';
  }

  if (!error) {
    return '当前位置获取失败，请检查浏览器定位权限。';
  }

  if (error.code === error.PERMISSION_DENIED) {
    return '定位权限被拒绝，请允许浏览器访问当前位置。';
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return '当前无法确定你的位置，请稍后重试。';
  }

  if (error.code === error.TIMEOUT) {
    return '定位请求超时，请检查网络或系统定位服务。';
  }

  return error.message || '当前位置获取失败，请检查浏览器定位权限。';
};

export const requestBrowserCurrentLocation = (
  options: BrowserLocationRequestOptions = {},
): Promise<BrowserCurrentLocation> => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error(resolveCurrentLocationErrorMessage()));
  }

  const requestOptions = {
    ...defaultLocationRequestOptions,
    ...options,
  };

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy || 0,
          timestamp: position.timestamp || Date.now(),
        });
      },
      (error) => {
        reject(new Error(resolveCurrentLocationErrorMessage(error)));
      },
      requestOptions,
    );
  });
};

export const watchBrowserCurrentLocation = (
  onLocation: CurrentLocationListener,
  onError?: CurrentLocationErrorListener,
  options: BrowserLocationRequestOptions = {},
): number => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error(resolveCurrentLocationErrorMessage());
  }

  const requestOptions = {
    ...defaultLocationRequestOptions,
    ...options,
  };

  return navigator.geolocation.watchPosition(
    (position) => {
      onLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy || 0,
        timestamp: position.timestamp || Date.now(),
      });
    },
    (error) => {
      onError?.(resolveCurrentLocationErrorMessage(error), error);
    },
    requestOptions,
  );
};

export const clearBrowserCurrentLocationWatch = (watchId: number | null | undefined) => {
  if (typeof watchId !== 'number') {
    return;
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return;
  }

  navigator.geolocation.clearWatch(watchId);
};
