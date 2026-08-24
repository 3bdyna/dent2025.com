import sys
import os
import json
import urllib.request
import urllib.error
import urllib.parse
import _toolkit

# Ensure UTF-8 stdout encoding on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def _load_health_passkey():
    """Read a passkey for authenticated probes from env or deploy_config.json (not hardcoded)."""
    env = os.environ.get('DENT2025_HEALTH_PASS', '')
    if env:
        return env
    try:
        cfg_path = os.path.join(_toolkit.PROJECT_ROOT, 'deploy_config.json')
        with open(cfg_path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        return cfg.get('health_passkey', '')
    except Exception:
        return ''

# List of core active endpoints to probe
ENDPOINTS_TO_PROBE = [
    {
        'name': 'WordPress Integrated API (dent2025_api.php)',
        'urls': [
            'https://dent2025.com/dent2025_api.php?action=data&specialty=dentistry&year=1&semester=1'
        ],
        'require_json_key': 'success'
    },
    {
        'name': 'Announcements API (announcements_api.php)',
        'urls': [
            'https://dent2025.com/announcements_api.php?action=get&specialty=dentistry&year=1&semester=1'
        ],
        'require_json_key': 'success'
    },
    {
        'name': 'Schedule Backend API (schedule_backend.php)',
        'urls': [
            'https://dent2025.com/schedule_backend.php'
        ],
        'require_json_key': 'success'
    },
    {
        'name': 'Audit History & SafeDeploy API (history_api.php)',
        'urls': [
            'https://dent2025.com/history_api.php?action=get_deployments'
        ],
        'require_json_key': 'success',
        'auth': True
    },
    {
        'name': 'Standalone PDO Data API (backend/api_data.php)',
        'urls': [
            'https://dent2025.com/backend/api_data.php'
        ],
        'require_json_key': 'success'
    },
    {
        'name': 'Standalone PDO Manage API (backend/api_manage.php)',
        'urls': [
            'https://dent2025.com/backend/api_manage.php'
        ],
        'require_json_key': 'success'
    },
    {
        'name': 'AI Exam Generation API (backend/api_ai_exam.php)',
        'urls': [
            'https://dent2025.com/backend/api_ai_exam.php'
        ],
        'require_json_key': 'success'
    }
]

def probe_single_url(url, key_req, passkey=None):
    try:
        if passkey:
            url = url + ('&' if '?' in url else '?') + 'password=' + urllib.parse.quote(passkey)
        req = urllib.request.Request(url, headers={'User-Agent': 'Dent2025-HealthProbe/1.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            body = response.read().decode('utf-8', errors='ignore')

            if status_code != 200:
                return False, status_code, f"HTTP status code {status_code}", body[:200]

            try:
                data = json.loads(body)
                if key_req and key_req not in data:
                    return False, 200, f"Malformed JSON: missing key '{key_req}'", body[:200]
                return True, 200, "Healthy response verified", ""
            except json.JSONDecodeError as err:
                return False, 200, f"JSON parse error: {str(err)}", body[:300]
    except urllib.error.HTTPError as http_err:
        return False, http_err.code, f"HTTP Error {http_err.code}: {http_err.reason}", ""
    except Exception as e:
        return False, 0, f"Connection failure: {str(e)}", ""

from concurrent.futures import ThreadPoolExecutor

def _probe_item(item, passkey):
    name = item['name']
    urls = item['urls']
    key_req = item['require_json_key']
    use_auth = item.get('auth', False)
    url_pass = passkey if use_auth else None

    last_cause = ""
    last_code = 0
    last_url = urls[0]

    for url in urls:
        ok, code, cause, snippet = probe_single_url(url, key_req, url_pass)
        if ok:
            return {
                'endpoint': name,
                'url': url,
                'status': 'OK',
                'code': 200,
                'cause': 'Healthy response verified'
            }
        else:
            last_code = code
            last_cause = cause
            last_url = url

    return {
        'endpoint': name,
        'url': last_url,
        'status': 'FAIL',
        'code': last_code,
        'cause': last_cause
    }

def run_health_probe():
    """Runs probes against live system APIs concurrently and returns diagnostic details."""
    passkey = _load_health_passkey()
    print("Running system health probes against live endpoints...", flush=True)

    with ThreadPoolExecutor(max_workers=min(len(ENDPOINTS_TO_PROBE), 8)) as executor:
        futures = [executor.submit(_probe_item, item, passkey) for item in ENDPOINTS_TO_PROBE]
        diagnostics = [f.result() for f in futures]

    overall_healthy = all(d['status'] == 'OK' for d in diagnostics)

    return {
        'healthy': overall_healthy,
        'diagnostics': diagnostics
    }

if __name__ == '__main__':
    res = run_health_probe()
    if res['healthy']:
        print("ALL SYSTEM HEALTH PROBES PASSED (HTTP 200 OK).")
        sys.exit(0)
    else:
        print("SYSTEM HEALTH PROBE DETECTED ERRORS:")
        for diag in res['diagnostics']:
            if diag['status'] == 'FAIL':
                print(f"  - [{diag['endpoint']}] Code {diag['code']}: {diag['cause']}")
        sys.exit(1)
