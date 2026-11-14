import ast
src = open('/Users/yatharthashah/Downloads/AI-Draft-main/main.py').read()
try:
    ast.parse(src)
    print('SYNTAX OK')
    lines = src.splitlines()
    print(f'647: {lines[646]!r}')
except SyntaxError as e:
    print(f'SyntaxError at line {e.lineno}: {e.msg}')
    lines = src.splitlines()
    for i in range(max(0, e.lineno - 3), min(len(lines), e.lineno + 1)):
        print(f'{i + 1:4d}: {lines[i]!r}')
