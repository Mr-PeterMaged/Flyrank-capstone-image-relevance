"""Execute the acceptance notebook without printing credentials or source records."""
from pathlib import Path
import nbformat
from nbclient import NotebookClient

root = Path(__file__).resolve().parents[1]
target = root / "notebooks" / "verify_capstone.ipynb"
notebook = nbformat.read(target, as_version=4)
NotebookClient(notebook, timeout=240, kernel_name="python3", resources={"metadata": {"path": str(root)}}).execute()
nbformat.write(notebook, target)
print("PASS notebook executed top to bottom. Evidence: docs/proof/")
