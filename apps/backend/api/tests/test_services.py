"""Tests for CPU architecture detection and service compatibility checks"""
import unittest
from unittest.mock import patch

from api.services import check_cpu_features, has_required_cpu_features


class TestServiceCPUCompatibility(unittest.TestCase):
    """Test CPU feature detection and compatibility checks"""

    @patch('api.services.platform.machine')
    def test_arm_architecture_detection(self, mock_machine):
        """Test that ARM architectures are detected correctly"""
        arm_architectures = ['aarch64', 'arm64', 'armv7l', 'armv8']
        
        for arch in arm_architectures:
            mock_machine.return_value = arch
            features = check_cpu_features()
            # On ARM, should return empty list as x86 features don't apply
            self.assertEqual(features, [], f"Expected empty list for {arch}")

    @patch('api.services.platform.machine')
    def test_x86_architecture_detection(self, mock_machine):
        """Test that x86 architectures attempt to check CPU features"""
        x86_architectures = ['x86_64', 'i686', 'i386', 'AMD64']
        
        for arch in x86_architectures:
            mock_machine.return_value = arch
            # Should not return early, will try to import cpuinfo
            # We can't easily test the cpuinfo part without mocking more
            features = check_cpu_features()
            # Should be a list (may be empty if cpuinfo not available)
            self.assertIsInstance(features, list, f"Expected list for {arch}")

    @patch('api.services.platform.machine')
    def test_has_required_cpu_features_on_arm(self, mock_machine):
        """Test that ARM architectures bypass x86-specific CPU checks"""
        mock_machine.return_value = 'aarch64'
        
        # LLM service has CPU requirements, but should be allowed on ARM
        result = has_required_cpu_features('llm')
        self.assertTrue(result, "LLM service should be compatible on ARM")

    @patch('api.services.platform.machine')
    def test_has_required_cpu_features_no_requirements(self, mock_machine):
        """Test services without CPU requirements are always compatible"""
        mock_machine.return_value = 'x86_64'
        
        # Service without requirements should always return True
        result = has_required_cpu_features('thumbnail')
        self.assertTrue(result, "Services without requirements should be compatible")

    @patch('api.services.platform.machine')
    @patch('api.services.check_cpu_features')
    def test_has_required_cpu_features_on_x86_with_features(self, mock_features, mock_machine):
        """Test x86 with required features present"""
        mock_machine.return_value = 'x86_64'
        mock_features.return_value = ['avx', 'avx2', 'sse4_2', 'fma', 'f16c']
        
        result = has_required_cpu_features('llm')
        self.assertTrue(result, "Should be compatible when all features present")

    @patch('api.services.platform.machine')
    @patch('api.services.check_cpu_features')
    def test_has_required_cpu_features_on_x86_missing_required(self, mock_features, mock_machine):
        """Test x86 missing required features"""
        mock_machine.return_value = 'x86_64'
        mock_features.return_value = []  # No features available
        
        result = has_required_cpu_features('llm')
        self.assertFalse(result, "Should be incompatible when required features missing")

    @patch('api.services.platform.machine')
    @patch('api.services.check_cpu_features')
    def test_has_required_cpu_features_on_x86_missing_recommended(self, mock_features, mock_machine):
        """Test x86 with required features but missing recommended ones"""
        mock_machine.return_value = 'x86_64'
        # Has required but not recommended
        mock_features.return_value = ['avx', 'sse4_2']
        
        result = has_required_cpu_features('llm')
        self.assertTrue(result, "Should be compatible with required features even if missing recommended")

    @patch('api.services.platform.machine')
    def test_case_insensitive_architecture_detection(self, mock_machine):
        """Test that architecture detection is case-insensitive"""
        # Test uppercase ARM
        mock_machine.return_value = 'AARCH64'
        features = check_cpu_features()
        self.assertEqual(features, [], "Should detect uppercase ARM architecture")
        
        # Test mixed case
        mock_machine.return_value = 'AArch64'
        features = check_cpu_features()
        self.assertEqual(features, [], "Should detect mixed case ARM architecture")
