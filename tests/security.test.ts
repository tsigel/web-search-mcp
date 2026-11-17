import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicHttpUrl, isPrivateAddress } from "../src/security.js";

test("classifies private IP ranges", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("192.168.1.2"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("rejects local and non-http URLs", async () => {
  await assert.rejects(assertPublicHttpUrl("http://127.0.0.1/test"), /Private/);
  await assert.rejects(assertPublicHttpUrl("file:///etc/passwd"), /http and https/);
  await assert.rejects(assertPublicHttpUrl("http://localhost/test"), /Local/);
});

test("accepts a public hostname behind the local DNS proxy range", async () => {
  const url = await assertPublicHttpUrl("https://www.uaz.ru/owner/manuals");
  assert.equal(url.hostname, "www.uaz.ru");
  await assert.rejects(assertPublicHttpUrl("http://198.18.10.183/"), /Private/);
});
