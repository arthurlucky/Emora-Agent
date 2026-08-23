#!/bin/bash
# Test script untuk verifikasi semua fitur baru

echo "🧪 EMORA Feature Test Suite"
echo "============================"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0

test_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $2"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} $2 (file not found: $1)"
        ((FAIL++))
    fi
}

test_npm_package() {
    if npm list "$1" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} $2"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} $2 (package not installed: $1)"
        ((FAIL++))
    fi
}

echo -e "${BLUE}Test 1: Core Files${NC}"
test_file "core/memoryDB.js" "SQLite memory system"
test_file "core/chatWithTitleGen.js" "Auto title wrapper"
test_file "tools/subagent.js" "Universal sub-agent tool"
test_file "tools/title_generator.js" "Title generator"
test_file "cli/cmd-migrate.js" "Migration command"
echo ""

echo -e "${BLUE}Test 2: Documentation${NC}"
test_file "MIGRATION.md" "Migration guide"
test_file "README_UPGRADE.md" "Upgrade notes"
test_file "IMPLEMENTATION_SUMMARY.md" "Implementation summary"
echo ""

echo -e "${BLUE}Test 3: Dependencies${NC}"
test_npm_package "better-sqlite3" "better-sqlite3 package"
echo ""

echo -e "${BLUE}Test 4: Tool Registration${NC}"
if grep -q "subagentTool" core/tools.js; then
    echo -e "${GREEN}✓${NC} subagent registered in tools.js"
    ((PASS++))
else
    echo -e "${RED}✗${NC} subagent not registered in tools.js"
    ((FAIL++))
fi

if grep -q "titleGeneratorTool" core/tools.js; then
    echo -e "${GREEN}✓${NC} title_generator registered in tools.js"
    ((PASS++))
else
    echo -e "${RED}✗${NC} title_generator not registered in tools.js"
    ((FAIL++))
fi
echo ""

echo -e "${BLUE}Test 5: CLI Commands${NC}"
if grep -q "case \"migrate\":" bin/emora.js; then
    echo -e "${GREEN}✓${NC} migrate command in CLI"
    ((PASS++))
else
    echo -e "${RED}✗${NC} migrate command not in CLI"
    ((FAIL++))
fi

if grep -q "\"-r\":" bin/emora.js || grep -q "\"--resume\":" bin/emora.js; then
    echo -e "${GREEN}✓${NC} resume command in CLI"
    ((PASS++))
else
    echo -e "${RED}✗${NC} resume command not in CLI"
    ((FAIL++))
fi
echo ""

echo -e "${BLUE}Test 6: Database${NC}"
if [ -f "memory/sessions.db" ]; then
    echo -e "${GREEN}✓${NC} SQLite database exists"
    ((PASS++))
    
    SIZE=$(du -h memory/sessions.db | cut -f1)
    echo -e "  ${BLUE}ℹ${NC}  Database size: $SIZE"
else
    echo -e "${YELLOW}⚠${NC}  SQLite database not found (run 'emora migrate' first)"
fi
echo ""

echo "============================"
echo -e "${GREEN}Passed: $PASS${NC}"
if [ $FAIL -gt 0 ]; then
    echo -e "${RED}Failed: $FAIL${NC}"
else
    echo -e "Failed: 0"
fi
echo "============================"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "Ready to use. Try:"
    echo "  emora                 # Start TUI"
    echo "  emora migrate         # Migrate data (if not done)"
    echo "  emora -r <uuid>       # Resume session"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    echo "Check the errors above and:"
    echo "  1. Run 'npm install' if dependencies missing"
    echo "  2. Check file paths if files not found"
    exit 1
fi
