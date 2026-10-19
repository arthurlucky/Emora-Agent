#!/bin/bash
# code_review.sh - Automated code review script

PROJECT_PATH="${1:-.}"

echo "🔍 Starting Code Review for: $PROJECT_PATH"
echo ""

# Check project structure
echo "✓ Checking project structure..."
if [ -f "$PROJECT_PATH/package.json" ]; then
  echo "  ✓ package.json found"
  echo "  Dependencies:"
  grep -E '"dependencies"|"devDependencies"' "$PROJECT_PATH/package.json" -A 5 | head -20
fi

echo ""
echo "✓ Folder structure:"
find "$PROJECT_PATH" -maxdepth 2 -type d | head -20

echo ""
echo "✓ Checking for key files..."
for file in "index.js" "app.js" "server.js" ".env" ".env.example" "eslint" "jest"; do
  if find "$PROJECT_PATH" -name "$file" -type f 2>/dev/null | grep -q .; then
    echo "  ✓ $file found"
  else
    echo "  ✗ $file missing"
  fi
done

echo ""
echo "✓ Checking for best practices..."
if grep -r "try.*catch" "$PROJECT_PATH" 2>/dev/null | grep -q .; then
  echo "  ✓ Error handling (try-catch) found"
else
  echo "  ⚠ No error handling detected"
fi

if grep -r "process.env" "$PROJECT_PATH" 2>/dev/null | grep -q .; then
  echo "  ✓ Environment variables usage found"
else
  echo "  ⚠ No environment config detected"
fi

echo ""
echo "✓ Review complete. Manual inspection recommended for:"
echo "  - Logic validation"
echo "  - Security patterns"
echo "  - Performance considerations"
