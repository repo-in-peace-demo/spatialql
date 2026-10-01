import { describe, expect, it } from 'vitest';
import { isQuestBrowser } from './xr-support.js';

describe('isQuestBrowser', () => {
  it('recognizes the Meta Quest Browser', () => {
    expect(
      isQuestBrowser(
        'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'OculusBrowser/35.1.0.0 SamsungBrowser/4.0 Chrome/126.0.0.0 VR Safari/537.36',
      ),
    ).toBe(true);
  });

  it('rejects desktop and phone browsers', () => {
    expect(
      isQuestBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/126.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
    expect(
      isQuestBrowser(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/126.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe(false);
  });
});
