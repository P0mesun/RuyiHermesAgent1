/**
 * after-pack.mjs — electron-builder afterPack hook.
 *
 * Stamps the Hermes icon + identity onto the packed Windows Hermes.exe via
 * rcedit (delegated to set-exe-identity.mjs). This runs for EVERY packed build
 * — first install, `hermes desktop`, the installer's --update rebuild, and a
 * dev's manual `npm run pack` — so the branded exe can never silently revert
 * to the stock "Electron" icon/name (the bug when the stamp lived only in
 * install.ps1, which the update path doesn't use).
 *
 * Windows-only: rcedit edits PE resources, irrelevant on macOS/Linux where the
 * app identity comes from the bundle Info.plist / desktop entry. Best-effort:
 * a stamp failure must never fail an otherwise-good build (worst case is the
 * stock icon, not a broken app), so we log and resolve rather than throw.
 *
 * electron-builder passes a context with:
 *   - electronPlatformName: 'win32' | 'darwin' | 'linux'
 *   - appOutDir:            the unpacked app directory for this target
 *   - packager.appInfo.productFilename: the exe basename (e.g. 'Hermes')
 */

import path from 'node:path'

import { bundlePythonBackend } from './bundle-python-backend.mjs'
import { stampExeIdentity } from './set-exe-identity.mjs'

export default async function afterPack(context) {
  // ---- macOS / Linux: bundle Python backend into Resources ----
  const platform = context.electronPlatformName
  const isWindows = platform === 'win32'

  if (!isWindows) {
    // On macOS / Linux, the app bundle lives at <appOutDir>/<productName>.app.
    // The bundled Python backend goes inside the .app's Resources so it ships
    // with the app and is self-contained on any machine with python3.
    const productName = context.packager?.appInfo?.productFilename || 'Hermes'
    const appBundle = platform === 'darwin'
      ? path.join(context.appOutDir, `${productName}.app`)
      : context.appOutDir
    const resourcesDir = path.join(appBundle, 'Contents', 'Resources')
    try {
      await bundlePythonBackend(resourcesDir)
    } catch (err) {
      // Non-fatal: the app can still fall back to HERMES_DESKTOP_HERMES_ROOT
      // or a system-level Hermes install.
      console.warn(`[after-pack] Python backend bundling failed (${err.message}); app will use external Hermes`)
    }
  }

  // ---- Windows: stamp exe identity ----
  if (isWindows) {
    const productName = context.packager?.appInfo?.productFilename || 'Hermes'
    const exe = path.join(context.appOutDir, `${productName}.exe`)

    try {
      await stampExeIdentity(exe, path.resolve(import.meta.dirname, '..'))
    } catch (err) {
      // Never fail the build over a cosmetic stamp.
      console.warn(`[after-pack] exe identity stamp failed (${err.message}); Hermes.exe keeps the stock Electron icon`)
    }
  }
}
