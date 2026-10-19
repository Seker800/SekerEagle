declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options: { url: string; runScripts: 'outside-only' });
    readonly window: {
      eval(script: string): void;
      close(): void;
      document: {
        querySelector(selector: string): {
          hasAttribute(name: string): boolean;
          click(): void;
          textContent: string | null;
        } | null;
      };
    };
  }
}
