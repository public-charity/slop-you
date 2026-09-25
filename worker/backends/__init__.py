from .base import BuildContext, BuildError, BuildResult, Photo


def get_backend(name: str):
    if name == "mock":
        from .mock import MockBackend

        return MockBackend()
    if name == "unreal":
        from .unreal import UnrealBackend

        return UnrealBackend()
    raise ValueError(f"Unknown backend: {name}")


__all__ = ["BuildContext", "BuildError", "BuildResult", "Photo", "get_backend"]
