#!/usr/bin/env python3
# Setup script for Star Graphics Generator
# Initialization and verification script

import os
import sys
from pathlib import Path

class Setup:
    """Setup utility untuk Star Graphics Generator"""
    
    REQUIRED_FILES = [
        'hello.py',
        'hello_demo.py',
        'config.json',
        'README.md',
        'CHANGELOG.md',
        'requirements.txt',
        'utils.py'
    ]
    
    @staticmethod
    def check_python_version():
        """Check Python version requirement"""
        print("📋 Checking Python version...")
        version = sys.version_info
        if version.major >= 3 and version.minor >= 6:
            print(f"   ✅ Python {version.major}.{version.minor}.{version.micro} - OK")
            return True
        else:
            print(f"   ❌ Python {version.major}.{version.minor} - FAILED (requires 3.6+)")
            return False
    
    @staticmethod
    def check_required_files():
        """Check if all required files exist"""
        print("\n📁 Checking required files...")
        all_exist = True
        
        for filename in Setup.REQUIRED_FILES:
            exists = os.path.isfile(filename)
            status = "✅" if exists else "❌"
            print(f"   {status} {filename}")
            if not exists:
                all_exist = False
        
        return all_exist
    
    @staticmethod
    def check_unicode_support():
        """Check Unicode support"""
        print("\n🌍 Checking Unicode support...")
        try:
            test_char = "★"
            test_char.encode(sys.stdout.encoding or 'utf-8')
            print(f"   ✅ Unicode support enabled - OK")
            return True
        except (UnicodeEncodeError, AttributeError):
            print(f"   ⚠️  Unicode support limited (emoji may not display correctly)")
            return False
    
    @staticmethod
    def create_backup():
        """Create backup of config file"""
        print("\n💾 Creating backup...")
        if os.path.isfile('config.json'):
            import shutil
            backup_file = 'config.json.backup'
            shutil.copy('config.json', backup_file)
            print(f"   ✅ Backup created: {backup_file}")
            return True
        return False
    
    @staticmethod
    def verify_installation():
        """Verify complete installation"""
        print("\n" + "="*60)
        print("  🔍 INSTALLATION VERIFICATION")
        print("="*60 + "\n")
        
        checks = {
            "Python Version": Setup.check_python_version(),
            "Required Files": Setup.check_required_files(),
            "Unicode Support": Setup.check_unicode_support(),
        }
        
        print("\n" + "="*60)
        print("  📊 VERIFICATION SUMMARY")
        print("="*60)
        
        all_passed = all(checks.values())
        passed_count = sum(checks.values())
        total_count = len(checks)
        
        for check_name, result in checks.items():
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"  {check_name:.<40} {status}")
        
        print(f"\n  Overall: {passed_count}/{total_count} checks passed\n")
        
        return all_passed
    
    @staticmethod
    def run_tests():
        """Run basic tests"""
        print("\n" + "="*60)
        print("  🧪 RUNNING BASIC TESTS")
        print("="*60 + "\n")
        
        tests_passed = 0
        tests_total = 3
        
        # Test 1: Import hello module
        print("Test 1: Importing hello module...")
        try:
            import hello
            print("   ✅ PASS - hello module imported successfully\n")
            tests_passed += 1
        except Exception as e:
            print(f"   ❌ FAIL - {e}\n")
        
        # Test 2: Import utils module
        print("Test 2: Importing utils module...")
        try:
            import utils
            print("   ✅ PASS - utils module imported successfully\n")
            tests_passed += 1
        except Exception as e:
            print(f"   ❌ FAIL - {e}\n")
        
        # Test 3: Load configuration
        print("Test 3: Loading configuration...")
        try:
            import json
            with open('config.json', 'r') as f:
                config = json.load(f)
            print(f"   ✅ PASS - config.json loaded successfully")
            print(f"      App: {config.get('app', {}).get('name', 'N/A')}\n")
            tests_passed += 1
        except Exception as e:
            print(f"   ❌ FAIL - {e}\n")
        
        print("="*60)
        print(f"  Test Results: {tests_passed}/{tests_total} passed")
        print("="*60 + "\n")
        
        return tests_passed == tests_total
    
    @staticmethod
    def print_next_steps():
        """Print next steps"""
        print("📖 Next Steps:")
        print("\n  1. Interactive Mode:")
        print("     python3 hello.py\n")
        print("  2. Demo Mode:")
        print("     python3 hello_demo.py\n")
        print("  3. View Utilities:")
        print("     python3 utils.py\n")
        print("  4. Read Documentation:")
        print("     cat README.md\n")
    
    @staticmethod
    def main():
        """Run complete setup"""
        print("\n" + "="*60)
        print("  🌟 STAR GRAPHICS GENERATOR - SETUP")
        print("="*60)
        
        # Run verification
        verification_passed = Setup.verify_installation()
        
        if not verification_passed:
            print("\n⚠️  Some checks failed. Please fix the issues above.")
            return False
        
        # Run tests
        tests_passed = Setup.run_tests()
        
        if not tests_passed:
            print("\n⚠️  Some tests failed. Please check your installation.")
            return False
        
        # Create backup
        Setup.create_backup()
        
        # Print success message
        print("\n" + "="*60)
        print("  ✨ SETUP COMPLETE!")
        print("="*60)
        
        Setup.print_next_steps()
        
        return True


def main():
    """Main entry point"""
    try:
        success = Setup.main()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n❌ Setup interrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Setup failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
