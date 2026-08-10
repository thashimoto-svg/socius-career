"use client";

import { preconnect } from "react-dom";

/**
 * Open the connections Firebase is about to need, before it needs them.
 *
 * The measured cost of restoring a session is ~380ms between subscribing to
 * `onAuthStateChanged` and its first callback, and most of that is not thinking
 * — it is one round trip to refresh a persisted ID token, and that round trip
 * starts with a DNS lookup and a TLS handshake to a host the browser has never
 * spoken to on this page. On a phone that handshake alone is 50–150ms.
 *
 * Nothing here fetches anything. It tells the browser which origins are coming
 * so the connection can be established while the JavaScript that will use it is
 * still downloading. The saving is whatever those two things overlap by.
 *
 * The three hosts, in the order the app reaches them:
 *
 *   securetoken      — refreshing the persisted ID token, inside the gate every
 *                      screen waits on
 *   identitytoolkit  — the account lookup that goes with it
 *   firestore        — users/{uid}, and then whatever the screen itself wants;
 *                      both start within ~70ms of the gate opening
 *
 * `crossOrigin: "anonymous"` on all three, because every one of these requests
 * is a CORS request without credentials. A connection opened in the other mode
 * is not the connection they would reuse, and the handshake would be paid
 * twice.
 *
 * The sign-in popup's hosts are deliberately absent: that flow only happens
 * after the student presses a button on the login screen, so a connection
 * opened at page load is a connection opened for nothing on every other visit.
 */
export function Preconnect() {
  preconnect("https://securetoken.googleapis.com", { crossOrigin: "anonymous" });
  preconnect("https://identitytoolkit.googleapis.com", {
    crossOrigin: "anonymous",
  });
  preconnect("https://firestore.googleapis.com", { crossOrigin: "anonymous" });

  return null;
}
