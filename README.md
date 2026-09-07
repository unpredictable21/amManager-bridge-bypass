# amManager WebAPI bridge accepts forged requests from any content process:

# silent addon uninstall/disable and installed-addon inventory oracle

**Component**: Toolkit → Add-ons Manager
**Tested on**: mozilla-firefox/firefox @ main (2026-09-05 snapshot); message delivery
verified live on Firefox 155.0.1 Windows release build
**Threat model**: attacker-controlled content process

## Summary

`amManager.sys.mjs` (`receiveMessage`, line 113) is the parent-side bridge for
mozAddonManager. Its only process gate is:

```js
if (!lazy.extensionsWebAPITesting &&
    lazy.separatePrivilegedMozillaWebContentProcess &&
    aMessage.target && aMessage.target.remoteType != null &&
    aMessage.target.remoteType !== "privilegedmozilla") {
  return undefined;
}
```

`browser.tabs.remote.separatePrivilegedMozillaWebContentProcess` has no default
entry in any libpref init file, so the code default `false` applies and the gate is
skipped in default configurations. The mozAddonManager security model — AMO-only
install sources, site allowlist, user gesture — lives entirely in the content
process (the amWebAPI.sys.mjs DOM bindings) and is never re-checked parent-side.

## What the forged bridge calls can do

From the `AddonManager.sys.mjs` webAPI object (line 3492), reachable with
`WebAPIPromiseRequest` from any content process:

1. `addonUninstall` (line 3693) checks only `PERM_CAN_UNINSTALL` and shows no
   confirmation — silent removal of arbitrary user extensions (ad blockers,
   password managers; system and policy-protected addons are excluded by the
   permission check).
2. `addonSetEnabled` (line 3705) has no checks at all — silently disable or enable
   any extension, e.g. disabling an ad blocker or password manager while a phishing
   page is open.
3. `getAddonByID` (line 3502) via `webAPIForAddon` (line 327) exposes id, version,
   type, name, description, isActive, isEnabled and canUninstall for any installed
   addon — an installed-addon inventory oracle usable for fingerprinting.
4. `sendAbuseReport` (line 3683) allows attacker-driven abuse-report spam.

The install flow keeps its gates — `createInstall` restricts sources to
`WEBAPI_INSTALL_HOSTS` and `setupPromptHandler` (line 3387) shows the permission
doorhanger when `requireConfirm` is true — so this report covers the management
verbs and the inventory oracle, not the install path. One anomaly worth noting:
`createInstall` accepts a content-supplied `triggeringPrincipal` from the message
payload.

## Reproduction (message delivery verified on the release build)

From chrome-privileged code inside a real content process, over the exact channel
mozAddonManager itself uses (window message manager → parent `Services.mm`
listener):

```js
const mm = contentWindow.docShell.messageManager;  // frame message manager
mm.addMessageListener("WebAPIPromiseResult", listener);
mm.sendAsyncMessage("WebAPIPromiseRequest",
                    { type: "addonUninstall", args: ["<addon-id>"] });
```

Live verification on Firefox 155.0.1: an instrumented `amManager.sys.mjs
receiveMessage` logged `WebAPIPromiseRequest` deliveries for `getAddonByID`,
`addonSetEnabled` and `addonUninstall` originating from the simulated compromised
process — the forged messages reach the bridge end-to-end over real IPC. Because
the reply is sent to a message-manager quirk (see `target.messageManager` in
`amManager`), reading the response back in the same script requires waiting out
`AddonManager` startup; the cleanest deterministic assertion of the final state is
`AddonManager.getAddonByID` (returns null after uninstall) or `extensions.json`,
either in a mochitest or a test build.

## Impact

Extension state exists only in the parent process; a compromised content process
has no legitimate way to modify it. Silently removing or disabling a user's ad
blocker or password manager is persistent parent-held state manipulation, and the
installed-addon inventory is sensitive information (fingerprinting, targeted
exploitation).

## Suggested fix

Enforce the `privilegedmozilla` remote type gate unconditionally, or move the
AMO-allowlist and permission decision into `amManager.receiveMessage` (parent side)
before dispatching to `AddonManager.webAPI`. `addonUninstall` and
`addonSetEnabled` should additionally require a parent-verified user confirmation.


## Source URLs

* `toolkit/mozapps/extensions/amManager.sys.mjs`
  * GitHub: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/amManager.sys.mjs
  * Searchfox: https://searchfox.org/firefox-main/source/toolkit/mozapps/extensions/amManager.sys.mjs
  * line 113: receiveMessage - remoteType gate (skipped by default)
    * GitHub: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/amManager.sys.mjs#L113
    * Searchfox: https://searchfox.org/firefox-main/source/toolkit/mozapps/extensions/amManager.sys.mjs#L113
* `toolkit/mozapps/extensions/AddonManager.sys.mjs`
  * GitHub: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/AddonManager.sys.mjs
  * Searchfox: https://searchfox.org/firefox-main/source/toolkit/mozapps/extensions/AddonManager.sys.mjs
  * line 327: webAPIForAddon - exposed addon properties
    * GitHub: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/AddonManager.sys.mjs#L327
    * Searchfox: https://searchfox.org/firefox-main/source/toolkit/mozapps/extensions/AddonManager.sys.mjs#L327
  * line 3387: setupPromptHandler (install confirmation; contrast)
    * GitHub: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/AddonManager.sys.mjs#L3387
    * Searchfox: https://searchfox.org/firefox-main/source/toolkit/mozapps/extensions/AddonManager.sys.mjs#L3387
  * line 3492: webAPI object
    * GitHub: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/AddonManager.sys.mjs#L3492
    * Searchfox: https://searchfox.org/firefox-main/source/toolkit/mozapps/extensions/AddonManager.sys.mjs#L3492
  * line 3693: addonUninstall
    * GitHub: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/AddonManager.sys.mjs#L3693
    * Searchfox: https://searchfox.org/firefox-main/source/toolkit/mozapps/extensions/AddonManager.sys.mjs#L3693
  * line 3705: addonSetEnabled
    * GitHub: https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/AddonManager.sys.mjs#L3705
    * Searchfox: https://searchfox.org/firefox-main/source/toolkit/mozapps/extensions/AddonManager.sys.mjs#L3705
