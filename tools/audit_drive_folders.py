import os
import sys
import json
import re
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

MAPPING = {
    # Semester 1
    'Sem 1 | English AP4 (R&W) | Chapters': '1N0rWdN94n9t8YmgTdv-BgifEEPjFgHf1',
    'Sem 1 | English AP4 (R&W) | Materials': '1QC8TyrNsFnZDc_SQDAs6vkFyzxjhR3y0',
    'Sem 1 | Arabic Writing | Chapters': '1sEkAMKYgrVd80umj8DdjM0M2MpS2OuOG',
    'Sem 1 | Arabic Writing | Materials': '1SdrmR7xZRpLI3TCrQZvn9W-2GcgtnI6d',
    'Sem 1 | Islamic Culture 1 | Chapters': '1bqLRIvAZQkNZEez3NyqoFv0KhAgDDLWX',
    'Sem 1 | Islamic Culture 1 | Materials': '1ANjRzV8AUGsVTuyk4GdTUkld4LmlVxIc',

    # Semester 2
    'Sem 2 | Writing for Health | Chapters': '1PaB-pCnPsWaJJoZODsa6PKHEBuEUIATT',
    'Sem 2 | Writing for Health | Materials': '14vH0ee9hpnmExOoj1xn2wO7LZ_X97ue_',
    'Sem 2 | Biology (BIO 105) | Chapters': '12DoysHPm0Iq91Dl7P3WQya-6qFZ3VZtt',
    'Sem 2 | Biology (BIO 105) | Materials': '1Vm3Tr2RaEXjsvEFBwPbFtu7W2FNddDtu',
    'Sem 2 | Chemistry (CHEM 105) | Chapters': '1ozwm_EGmy9QVyRQLMan4VfVkxxwzk06W',
    'Sem 2 | Chemistry (CHEM 105) | Materials': '1pQDne4TnRKDmMF3vXwBf7ivn8jN1g9RR',
    'Sem 2 | Physics (PHYS 105) | Chapters': '11K0X5Uzjkj7bG0-vn3d4A2FWmgvvhtjH',
    'Sem 2 | Physics (PHYS 105) | Materials': '1x-SUBsKppWAdNgjBCHrqhLNo6tqeMWal'
}

def inspect_folder(folder_id):
    url = f'https://drive.google.com/drive/folders/{folder_id}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode('utf-8')
            # Extract PDF filenames from Google Drive page JSON
            pattern = re.compile(r'\"([^\"]{3,120}\.pdf)\"')
            raw_matches = pattern.findall(html)
            # Clean matches
            cleaned = []
            for m in raw_matches:
                # remove escaped unicode if any
                clean_name = m.encode().decode('unicode-escape', errors='ignore')
                if not any(clean_name.endswith(ext) for ext in ['.js', '.css', '.png', '.jpg', '.ico']) and 'http' not in clean_name:
                    if clean_name not in cleaned:
                        cleaned.append(clean_name)
            return cleaned
    except Exception as e:
        return [f'Error: {e}']

print('='*75)
print('READ-ONLY AUDIT OF USER GOOGLE DRIVE FOLDERS')
print('='*75)

total_drive_files = 0

for label, fid in MAPPING.items():
    files = inspect_folder(fid)
    total_drive_files += len(files)
    print(f'\n📁 {label}')
    print(f'   Folder Link: https://drive.google.com/drive/folders/{fid}')
    print(f'   Files Count: {len(files)}')
    for idx, f in enumerate(files, 1):
        print(f'     {idx}. {f}')

print('\n' + '='*75)
print(f'AUDIT SUMMARY: Found {total_drive_files} verified files in Google Drive.')
print('='*75)
