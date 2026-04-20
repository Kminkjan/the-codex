export {};

declare global {
  interface Window {
    __TWEAKS__: {
      theme: string;
      showPresence: boolean;
      density: string;
      [key: string]: unknown;
    };
  }
}
