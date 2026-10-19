#!/bin/bash
# nodejs-audit.sh - Quick Node.js app audit

PROJECT_PATH="${1:-.}"
OUTPUT_FILE="audit-report-$(date +%s).md"

echo "🔍 Starting Node.js Code Audit for: $PROJECT_PATH"
echo ""

# Check if package.json exists
if [ ! -f "$PROJECT_PATH/package.json" ]; then
  echo "❌ Error: package.json not found in $PROJECT_PATH"
  exit 1
fi

echo "📋 Folder Structure:"
find "$PROJECT_PATH" -type f -name '*.js' | head -20
echo ""

echo "📦 Dependencies:"
jq '.dependencies, .devDependencies' "$PROJECT_PATH/package.json" 2>/dev/null || echo "Could not parse package.json"
echo ""

echo "🔐 Security Check:"
echo "Looking for common issues..."
grep -r "console\.log" "$PROJECT_PATH" --include="*.js" | wc -l | xargs echo "  - console.log calls found:"
grep -r "Math\.max\|length + 1" "$PROJECT_PATH" --include="*.js" | wc -l | xargs echo "  - Potential ID generation issues:"
grep -r "CORS\|cors" "$PROJECT_PATH" --include="*.js" | wc -l | xargs echo "  - CORS configuration references:"
echo ""

echo "✅ Audit complete. Review code manually for:"
echo "  1. Error handler middleware positioning"
echo "  2. Input validation patterns"
echo "  3. Environment variable usage"
echo "  4. Rate limiting implementation"
echo "  5. Request logging setup"
