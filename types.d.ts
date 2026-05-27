interface YourSDK {
  track(eventName: string, payload?: Record<string, any>): void;
  identify(opts: { userId: string }): void;
  setConsent(v: boolean): void;
  reset(): void;
}

declare global {
  interface Window { YourSDK: YourSDK; }
}

export {};
