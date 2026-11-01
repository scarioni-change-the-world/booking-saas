import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '@/lib/site-fetch';

describe('isPrivateAddress', () => {
  it('refuses addresses no public website is on', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('lets public addresses through', () => {
    for (const ip of ['198.185.159.144', '8.8.8.8', '2606:4700::6810:84e5', '172.32.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});
