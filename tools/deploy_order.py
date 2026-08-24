import sys
import os

def get_file_tier(file_path):
    """Categorizes file into deployment priority tier (1-4). Lower tier deploys first."""
    normalized = file_path.replace('\\', '/').lower()
    base_name = os.path.basename(normalized)

    # Tier 1: Database, RBAC Core & Schema helpers
    if any(k in base_name for k in ['setup_db', 'db_connect', 'dent2025_rbac', 'history_helpers']) or base_name.endswith('.sql'):
        return 1
    
    # Tier 2: Core PHP Backends & APIs
    if base_name.endswith('.php') and ('api' in base_name or base_name in ['dent2025_api.php', 'schedule_backend.php', 'announcements_api.php', 'purge_cache.php', 'auto_relink.php']):
        return 2
        
    # Tier 3: Admin Dashboard & Loader Infrastructure
    if 'loader' in base_name or 'admin_app' in base_name or 'admin_dashboard' in base_name or 'deploy_dashboard' in base_name:
        return 3
        
    # Tier 4: Frontend HTML/JS/CSS components & everything else
    return 4

def sort_files_by_priority(file_paths):
    """Sorts input file list according to priority tiers."""
    return sorted(file_paths, key=lambda f: (get_file_tier(f), f))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python deploy_order.py <file1> [file2...]")
        sys.exit(1)

    sorted_files = sort_files_by_priority(sys.argv[1:])
    print("Ordered deployment sequence:")
    for f in sorted_files:
        tier = get_file_tier(f)
        print(f"  [Tier {tier}] {f}")
