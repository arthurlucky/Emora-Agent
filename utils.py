#!/usr/bin/env python3
# Star Graphics Utilities Module
# Utility functions for the Star Graphics Generator

import json
import os
import sys
from pathlib import Path

class ConfigManager:
    """Manage configuration files"""
    
    DEFAULT_CONFIG_PATH = "config.json"
    
    @staticmethod
    def load_config(config_path=None):
        """Load configuration from JSON file"""
        path = config_path or ConfigManager.DEFAULT_CONFIG_PATH
        
        try:
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            else:
                return ConfigManager.get_default_config()
        except Exception as e:
            print(f"⚠️  Error loading config: {e}")
            return ConfigManager.get_default_config()
    
    @staticmethod
    def get_default_config():
        """Get default configuration"""
        return {
            "animation": {"delay": 0.5},
            "patterns": {
                "pyramid": {"default_height": 6},
                "diamond": {"default_size": 5},
                "rectangle": {"default_width": 20, "default_height": 6},
                "checkerboard": {"default_size": 8},
                "hourglass": {"default_size": 7}
            }
        }
    
    @staticmethod
    def save_config(config, config_path=None):
        """Save configuration to JSON file"""
        path = config_path or ConfigManager.DEFAULT_CONFIG_PATH
        
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"⚠️  Error saving config: {e}")
            return False


class TerminalHelper:
    """Helper functions for terminal operations"""
    
    @staticmethod
    def is_unicode_supported():
        """Check if terminal supports Unicode"""
        try:
            "★".encode(sys.stdout.encoding or 'utf-8')
            return True
        except (UnicodeEncodeError, AttributeError):
            return False
    
    @staticmethod
    def get_terminal_size():
        """Get terminal width and height"""
        try:
            import shutil
            width, height = shutil.get_terminal_size()
            return width, height
        except Exception:
            return 80, 24
    
    @staticmethod
    def print_header(title, width=60):
        """Print formatted header"""
        print("=" * width)
        print(f"  {title}")
        print("=" * width)
    
    @staticmethod
    def print_separator(char="-", width=60):
        """Print separator line"""
        print(char * width)
    
    @staticmethod
    def print_success(message):
        """Print success message"""
        print(f"✅ {message}")
    
    @staticmethod
    def print_error(message):
        """Print error message"""
        print(f"❌ {message}")
    
    @staticmethod
    def print_warning(message):
        """Print warning message"""
        print(f"⚠️  {message}")
    
    @staticmethod
    def print_info(message):
        """Print info message"""
        print(f"ℹ️  {message}")


class FileHelper:
    """Helper functions for file operations"""
    
    @staticmethod
    def ensure_directory(path):
        """Ensure directory exists"""
        Path(path).mkdir(parents=True, exist_ok=True)
    
    @staticmethod
    def get_project_root():
        """Get project root directory"""
        return os.path.dirname(os.path.abspath(__file__))
    
    @staticmethod
    def list_python_files(directory="."):
        """List all Python files in directory"""
        return list(Path(directory).glob("*.py"))
    
    @staticmethod
    def get_file_size(path):
        """Get file size in bytes"""
        try:
            return os.path.getsize(path)
        except Exception:
            return 0
    
    @staticmethod
    def format_file_size(size):
        """Format file size to human-readable format"""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024:
                return f"{size:.2f} {unit}"
            size /= 1024
        return f"{size:.2f} TB"


class SystemInfo:
    """Get system information"""
    
    @staticmethod
    def get_python_version():
        """Get Python version"""
        return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    
    @staticmethod
    def get_platform():
        """Get platform name"""
        return sys.platform
    
    @staticmethod
    def get_encoding():
        """Get system encoding"""
        return sys.getdefaultencoding()
    
    @staticmethod
    def get_system_info():
        """Get complete system information"""
        return {
            "python_version": SystemInfo.get_python_version(),
            "platform": SystemInfo.get_platform(),
            "encoding": SystemInfo.get_encoding(),
            "unicode_support": TerminalHelper.is_unicode_supported(),
            "terminal_size": TerminalHelper.get_terminal_size()
        }


class PatternRegistry:
    """Registry for available patterns"""
    
    PATTERNS = {
        '1': {'name': 'Pyramid', 'description': 'Piramida bertingkat'},
        '2': {'name': 'Diamond', 'description': 'Bentuk berlian'},
        '3': {'name': 'Rectangle', 'description': 'Persegi panjang'},
        '4': {'name': 'Wave', 'description': 'Pola gelombang'},
        '5': {'name': 'Heart', 'description': 'Bentuk hati'},
        '6': {'name': 'Spiral', 'description': 'Spiral mengisi grid'},
        '7': {'name': 'Galaxy', 'description': 'Konstelasi galaksi'},
        '8': {'name': 'Checkerboard', 'description': 'Papan catur'},
        '9': {'name': 'Hourglass', 'description': 'Jam pasir'},
        '10': {'name': 'All Patterns', 'description': 'Semua pola'},
        '11': {'name': 'Animated Wave', 'description': 'Gelombang animasi'},
    }
    
    @staticmethod
    def get_pattern(key):
        """Get pattern info by key"""
        return PatternRegistry.PATTERNS.get(key)
    
    @staticmethod
    def list_patterns():
        """List all available patterns"""
        return PatternRegistry.PATTERNS
    
    @staticmethod
    def get_pattern_count():
        """Get total number of patterns"""
        return len(PatternRegistry.PATTERNS)


def print_system_info():
    """Print system information"""
    TerminalHelper.print_header("System Information")
    info = SystemInfo.get_system_info()
    for key, value in info.items():
        print(f"  {key:.<30} {value}")
    print()


def print_patterns():
    """Print available patterns"""
    TerminalHelper.print_header("Available Patterns")
    patterns = PatternRegistry.list_patterns()
    for key, pattern in patterns.items():
        print(f"  {key:2}. {pattern['name']:20} - {pattern['description']}")
    print()


def main():
    """Main utility function"""
    TerminalHelper.print_header("Star Graphics - Utility Module")
    print()
    
    # Print system info
    print_system_info()
    
    # Print patterns
    print_patterns()
    
    # Print project info
    TerminalHelper.print_header("Project Information")
    config = ConfigManager.load_config()
    print(f"  App Name: {config.get('app', {}).get('name', 'N/A')}")
    print(f"  Version: {config.get('app', {}).get('version', 'N/A')}")
    print(f"  Author: {config.get('app', {}).get('author', 'N/A')}")
    print()


if __name__ == "__main__":
    main()
