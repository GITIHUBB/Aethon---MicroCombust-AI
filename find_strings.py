import ast
src = open('main.py').read()
tree = ast.parse(src)
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef):
        # check docstring
        if node.body and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant):
            doc = node.body[0].value.value
            if doc and len(doc) > 20:
                print(f'{node.name} docstring OK')
