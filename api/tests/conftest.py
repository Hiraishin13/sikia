"""Les tests sont hermétiques : jamais de vraie clé API, jamais d'appel réseau vers un fournisseur."""

import os

# Doit être fait avant l'import de app.main (qui construit une application à l'import).
os.environ["SIKIA_NO_DOTENV"] = "1"
os.environ["SIKIA_TRANSLATOR"] = "stub"
for var in ("SIKIA_MODEL_DIR", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"):
    os.environ.pop(var, None)
