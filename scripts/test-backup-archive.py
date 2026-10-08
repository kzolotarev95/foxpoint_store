"""Reject traversal, links, duplicate entries and incomplete archives before extracting files."""
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("backup_archive", Path(__file__).with_name("panel-backup-archive.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class ArchiveSafety(unittest.TestCase):
    def test_unsafe_members_leave_destination_empty(self):
        for name, kind in [("app/../../escape", tarfile.REGTYPE), ("/app/escape", tarfile.REGTYPE), ("app/C:/escape", tarfile.REGTYPE), ("app\\escape", tarfile.REGTYPE), ("app/link", tarfile.SYMTYPE), ("app/link", tarfile.LNKTYPE), ("app/pipe", tarfile.FIFOTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                archive = root / "unsafe.tar.gz"
                with tarfile.open(archive, "w:gz") as packed:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "../../escape"
                    packed.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    helper.unpack(archive, root / "unpacked")
                self.assertEqual(list((root / "unpacked").iterdir()), [])

    def test_duplicate_and_incomplete(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for duplicate in [False, True]:
                archive = root / f"incomplete-{duplicate}.tar.gz"
                with tarfile.open(archive, "w:gz") as packed:
                    packed.addfile(tarfile.TarInfo("app/package.json"), io.BytesIO())
                    if duplicate:
                        packed.addfile(tarfile.TarInfo("app/package.json"), io.BytesIO())
                with self.assertRaises(ValueError):
                    helper.unpack(archive, root / f"unpacked-{duplicate}")


if __name__ == "__main__":
    unittest.main()
