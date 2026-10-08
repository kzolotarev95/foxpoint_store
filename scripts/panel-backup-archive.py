"""Portable archive of the complete FoxPoint application and its backup payload."""
import argparse
import os
from pathlib import Path, PurePosixPath
import tarfile

GENERATED = {"node_modules", ".next", "dist", ".turbo", "__pycache__", ".codex-temp"}
MAX_UNPACKED = 100 * 1024 ** 3
MAX_FILES = 250000


def inspect(archive):
    total = 0
    count = 0
    names = set()
    for member in archive:
        path = PurePosixPath(member.name)
        if (path.is_absolute() or ".." in path.parts or "\\" in member.name
                or not path.parts or path.parts[0] not in {"app", "backup"}
                or any(":" in part or "\x00" in part for part in path.parts)
                or not (member.isfile() or member.isdir())):
            raise ValueError("Недопустимый путь или тип файла в архиве")
        if member.name in names:
            raise ValueError("Повторный путь в архиве")
        names.add(member.name)
        total += member.size
        count += 1
        if count > MAX_FILES or total > MAX_UNPACKED:
            raise ValueError("Архив превышает допустимый объём распаковки")
    required = {"app/package.json", "app/package-lock.json", "app/.env",
                "app/packages/db/prisma/schema.prisma", "backup/manifest.json", "backup/database.dump"}
    if not required.issubset(names):
        raise ValueError("Это не полный архив FOX POINT: отсутствуют обязательные файлы")


def pack(application, payload, output):
    application = application.resolve(strict=True)
    payload = payload.resolve(strict=True)
    for private_path in [output.resolve(), payload]:
        if private_path.is_relative_to(application) and not any(part in GENERATED for part in private_path.relative_to(application).parts):
            raise ValueError("Архив и служебный дамп должны храниться вне сохраняемых файлов приложения")
    with tarfile.open(output, "w:gz", dereference=True) as archive:
        def include(member):
            relative = PurePosixPath(member.name).parts[1:]
            if any(part in GENERATED for part in relative):
                return None
            if member.isfifo() or member.isdev():
                raise ValueError("Специальный файл внутри приложения: " + member.name)
            return member
        archive.add(application, arcname="app", filter=include)
        archive.add(payload, arcname="backup")
    with tarfile.open(output, "r:gz") as archive:
        inspect(archive)


def unpack(source, destination):
    destination = destination.resolve()
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError("Каталог распаковки должен быть пустым")
    with tarfile.open(source, "r:gz") as archive:
        inspect(archive)
    with tarfile.open(source, "r:gz") as archive:
        for member in archive:
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            if not target.resolve().is_relative_to(destination):
                raise ValueError("Путь выходит за каталог распаковки")
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                stream = archive.extractfile(member)
                with target.open("xb") as output:
                    while block := stream.read(1024 * 1024):
                        output.write(block)
                os.chmod(target, member.mode & 0o777)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["pack", "unpack"])
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args()
    try:
        if args.operation == "pack" and len(args.paths) == 3:
            pack(*map(Path, args.paths))
        elif args.operation == "unpack" and len(args.paths) == 2:
            unpack(*map(Path, args.paths))
        else:
            parser.error("Неверное число путей")
    except (ValueError, OSError, tarfile.TarError) as error:
        raise SystemExit(str(error))
