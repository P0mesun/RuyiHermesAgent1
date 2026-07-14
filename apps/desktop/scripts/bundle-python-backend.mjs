/**
 * bundle-python-backend.mjs
 *
 * Bundles the Hermes Python backend into the packaged app's Resources so the
 * desktop app can run on a machine without the Hermes source tree.
 *
 * What it does:
 *   1. Installs core Python deps into a vendor/ directory (hermetic, no venv)
 *   2. Copies the hermes_cli/ package + top-level Python modules
 *   3. Wiring: called from `after-pack.mjs` so the bundle lands inside the
 *      app's Resources before code-signing.
 *
 * The bundled backend is discovered by the modified resolveHermesBackend()
 * in electron/main.ts (step "2.5 — Bundled backend").
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..');

// ---- helpers ----

function sh(command, options = {}) {
  console.log(`  $ ${command}`);
  return execSync(command, { stdio: 'inherit', ...options });
}

function dirSize(p) {
  try {
    const bytes = statSync(p).size;
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  } catch {
    return '?';
  }
}

// ---- main ----

/**
 * @param {string} resourcesDir — e.g. Hermes.app/Contents/Resources/
 * @param {object} opts
 * @param {boolean} opts.dryRun — if true, print plan but don't execute
 */
export async function bundlePythonBackend(resourcesDir, opts = {}) {
  const targetDir = path.join(resourcesDir, 'hermes-python');
  const vendorDir = path.join(targetDir, 'vendor');
  const pipBinary = path.join(REPO_ROOT, '.venv', 'bin', 'pip');

  console.log('[bundle-python] Bundling Python backend');
  console.log(`  Source repo:     ${REPO_ROOT}`);
  console.log(`  Resources:       ${resourcesDir}`);
  console.log(`  Target:          ${targetDir}`);

  if (opts.dryRun) {
    console.log('[bundle-python] Dry run — skipping actual work');
    return;
  }

  // --- 1. Prepare target directory ---
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });

  // --- 2. Copy Python source files ---
  console.log('[bundle-python] Copying Python source...');

  // Top-level .py modules needed at runtime
  const TOP_MODULES = [
    'run_agent.py', 'model_tools.py', 'toolsets.py',
    'batch_runner.py', 'trajectory_compressor.py',
    'toolset_distributions.py', 'cli.py', 'hermes_bootstrap.py',
    'hermes_constants.py', 'hermes_state.py', 'hermes_time.py',
    'hermes_logging.py', 'utils.py', 'mcp_serve.py',
  ];

  for (const mod of TOP_MODULES) {
    const src = path.join(REPO_ROOT, mod);
    if (existsSync(src)) {
      cpSync(src, path.join(targetDir, mod));
    }
  }

  // Package directories
  const PACKAGES = [
    'hermes_cli', 'agent', 'tools', 'gateway', 'tui_gateway',
    'cron', 'acp_adapter', 'plugins', 'providers',
  ];

  for (const pkg of PACKAGES) {
    const src = path.join(REPO_ROOT, pkg);
    if (existsSync(src)) {
      cpSync(src, path.join(targetDir, pkg), { recursive: true });
    }
  }

  // locales (data files needed at runtime)
  const localesSrc = path.join(REPO_ROOT, 'locales');
  if (existsSync(localesSrc)) {
    cpSync(localesSrc, path.join(targetDir, 'locales'), { recursive: true });
  }

  // optional-mcps
  const mcpSrc = path.join(REPO_ROOT, 'optional-mcps');
  if (existsSync(mcpSrc)) {
    cpSync(mcpSrc, path.join(targetDir, 'optional-mcps'), { recursive: true });
  }

  console.log('[bundle-python] Source files copied.');

  // --- 3. Install Python dependencies into vendor/ ---
  console.log('[bundle-python] Installing Python dependencies...');

  const coreDeps = [
    'openai==2.24.0',
    'certifi==2026.5.20',
    'python-dotenv==1.2.2',
    'fire==0.7.1',
    'httpx[socks]==0.28.1',
    'rich==14.3.3',
    'tenacity==9.1.4',
    'pyyaml==6.0.3',
    'ruamel.yaml==0.18.17',
    'requests==2.33.0',
    'jinja2==3.1.6',
    'pydantic==2.13.4',
    'prompt_toolkit==3.0.52',
    'croniter==6.0.0',
    'packaging==26.0',
    'Markdown==3.10.2',
    'PyJWT[crypto]==2.13.0',
    'urllib3>=2.7.0,<3',
    'cryptography==46.0.7',
    'psutil==7.2.2',
    'websockets==15.0.1',
    'pathspec==1.1.1',
    'fastapi>=0.104.0,<1',
    'uvicorn[standard]>=0.24.0,<1',
    'python-multipart>=0.0.9,<1',
    'Pillow==12.2.0',
  ];

  const requirementsPath = path.join(targetDir, 'requirements-vendor.txt');
  writeFileSync(requirementsPath, coreDeps.join('\n') + '\n');

  // Use pip install --target for a hermetic vendor directory
  try {
    sh(
      `"${pipBinary}" install --target="${vendorDir}" --no-compile -r "${requirementsPath}"`,
      { timeout: 300_000 }
    );
    console.log('[bundle-python] Dependencies installed.');
  } catch (err) {
    console.error('[bundle-python] pip install failed:', err.message);
    console.error('[bundle-python] Falling back: the app will use system-level resolution.');
    // Non-fatal: the app can still work via HERMES_DESKTOP_HERMES_ROOT
  }

  // Clean up requirements file
  try { rmSync(requirementsPath); } catch {}

  // --- 4. Report ---
  try {
    console.log(`[bundle-python] Done (target: ${dirSize(targetDir)})`);
    if (existsSync(vendorDir)) {
      console.log(`[bundle-python] Vendor deps: ${dirSize(vendorDir)}`);
    }
  } catch {
    console.log('[bundle-python] Done.');
  }
}
