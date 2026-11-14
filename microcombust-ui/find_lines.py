lines = open('/Users/yatharthashah/Downloads/AI-Draft-main/microcombust-ui/app/Dashboard.jsx').read().splitlines(keepends=True)
for i, l in enumerate(lines):
    if 'shadow-orange-500/20' in l or 'from-orange-500/15 to-amber-500/15 border border-orange-500/35' in l:
        print(f'{i + 1}: {l}')
