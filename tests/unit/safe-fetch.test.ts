import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "@/lib/api-response";
import { assertPublicUrl, isBlockedAddress } from "@/lib/safe-fetch";

test("private, local and special addresses are blocked, in both families", () => {
  const blocked = [
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.1.2.3",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.168.1.1", "198.18.0.1", "198.19.255.255",
    "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    "::ffff:8.8.8.8", "64:ff9b::7f00:1", "2002:7f00:1::1",
    // IPv4-compatible (deprecated, still IPv4 inside), site-local, local NAT64, Teredo, discard.
    "::7f00:1", "::a00:1", "fec0::1", "feff::1", "64:ff9b:1::7f00:1", "2001::7f00:1", "2001:0:ffff::1", "100::1",
  ];
  for (const ip of blocked) assert.equal(isBlockedAddress(ip), true, ip);
});

test("ordinary public addresses pass, including the ones next to private ranges", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "192.167.1.1", "198.17.255.255", "198.20.0.1", "223.255.255.255", "2606:4700:4700::1111", "2a00:1450:4001::64", "2001:4860:4860::8888", "2001:1::1"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
  for (const bad of ["", "not-an-ip", "999.1.1.1", "localhost"]) assert.equal(isBlockedAddress(bad), true, `unparseable ${bad} counts as blocked`);
});

const refused = (message: RegExp) => (error: unknown) => error instanceof AppError && error.code === "VALIDATION_ERROR" && message.test(error.message);

test("only http(s) URLs to public names or addresses are accepted", () => {
  assert.equal(assertPublicUrl("https://example.com/a?b=c").href, "https://example.com/a?b=c");
  assert.equal(assertPublicUrl("http://example.com:8080/x").port, "8080");
  assert.equal(assertPublicUrl("https://8.8.8.8/").hostname, "8.8.8.8");
  assert.throws(() => assertPublicUrl("not a url"), refused(/not a valid link/));
  assert.throws(() => assertPublicUrl("ftp://example.com/x"), refused(/http/));
  assert.throws(() => assertPublicUrl("javascript:alert(1)"), refused(/http/));
  assert.throws(() => assertPublicUrl("file:///etc/passwd"), refused(/http/));
  assert.throws(() => assertPublicUrl("webcal://example.com/c.ics"), refused(/http/));
  assert.equal(assertPublicUrl("webcal://example.com/c.ics", ["http:", "https:", "webcal:"]).protocol, "https:");
});

test("local names and private addresses are refused before any request, in every spelling", () => {
  for (const raw of [
    "http://localhost/", "http://LOCALHOST:3200/", "http://app.localhost/", "http://ntfy/", "http://postgres:5432/",
    "http://host.docker.internal:11434/", "http://router.lan/", "http://printer.local/", "http://nas.home.arpa/",
    "http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://0177.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.0:3000/", "http://169.254.169.254/latest/meta-data/", "http://100.100.100.100/", "http://10.1.2.3/",
  ]) {
    assert.throws(() => assertPublicUrl(raw), refused(/not reachable from this server/), raw);
  }
});

test("a link carrying a user name or password is refused", () => {
  assert.throws(() => assertPublicUrl("https://user:secret@example.com/"), refused(/user name or password/));
});
