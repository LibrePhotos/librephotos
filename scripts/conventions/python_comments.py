import ast
import io
import json
import sys
import tokenize
import warnings

DOCSTRING_OWNERS = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)


def comment_tokens(text: str) -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        if token.type == tokenize.COMMENT:
            found.append({"start": token.start[0], "end": token.end[0], "kind": "comment", "text": token.string})
    return found


def is_string_statement(node: ast.AST) -> bool:
    return isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)


def string_statements(text: str) -> list[dict[str, object]]:
    tree = ast.parse(text)
    docstrings = {id(owner.body[0]) for owner in ast.walk(tree) if isinstance(owner, DOCSTRING_OWNERS) and owner.body}
    found: list[dict[str, object]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and is_string_statement(node):
            kind = "docstring" if id(node) in docstrings else "string statement"
            found.append({"start": node.lineno, "end": node.end_lineno, "kind": kind, "text": ""})
    return found


def scan(text: str) -> dict[str, object]:
    try:
        return {"comments": comment_tokens(text) + string_statements(text)}
    except (SyntaxError, tokenize.TokenError, ValueError) as error:
        return {"error": f"{type(error).__name__}: {error}"}


def main() -> None:
    warnings.simplefilter("ignore")
    files: dict[str, str] = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    result = {path: scan(text) for path, text in files.items()}
    sys.stdout.buffer.write(json.dumps(result).encode("ascii"))


if __name__ == "__main__":
    main()
