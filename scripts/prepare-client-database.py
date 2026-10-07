"""Read the supplied register without modifying the workbook (requires openpyxl)."""
import argparse
import json
import re
from datetime import date, datetime
from pathlib import Path

import openpyxl


def money(value):
    if value is None or value == "":
        return None
    return float(re.sub(r"[\s₽]", "", str(value)).replace(",", "."))


def prepare(source: Path):
    workbook = openpyxl.load_workbook(source, data_only=True, read_only=True)
    rows = []
    for cells in workbook["Клиенты"].iter_rows(min_row=2, values_only=True):
        if not isinstance(cells[0], str) or not cells[0].startswith("CLI-"):
            continue
        code, name = cells[0], cells[1]
        if not name or not str(name).strip():
            print(f"Пропущена незаполненная строка {code}")
            continue
        months = int(cells[11] or 0)
        tariff = cells[6]
        amount = money(cells[15])
        monthly = money(cells[8])
        started = cells[10]
        if started is not None and not isinstance(started, (datetime, date)):
            raise ValueError(f"Некорректная дата первой подписки: {code}")
        row = {
            "clientCode": code, "name": str(name).strip(),
            "phone": str(cells[2]).strip() if cells[2] is not None else None,
            "telegram": str(cells[3]).strip() if cells[3] is not None else None,
            "city": str(cells[4]).strip() if cells[4] is not None else None,
            "routerName": str(cells[5]).strip(), "tariff": tariff, "state": cells[7],
            "monthlyPrice": monthly, "startDate": started.strftime("%Y-%m-%d") if started else None,
            "paidMonths": months, "paidAmount": amount,
            "note": str(cells[16]).strip() if cells[16] is not None else None,
        }
        # The owner confirmed that SPB-11/2 means two physical routers.
        # This row has no recorded payment; no historical payment is duplicated.
        if code == "CLI-0013" and row["routerName"] == "SPB-11/2":
            if row["paidMonths"] or row["paidAmount"]:
                raise ValueError("Уточните распределение оплаты между двумя роутерами CLI-0013")
            rows.append({**row, "routerName": "SPB-11"})
        rows.append(row)
    workbook.close()
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output", type=Path, default=Path("scripts/data/foxpoint-client-database.json"))
    args = parser.parse_args()
    prepared = prepare(args.workbook)
    if args.output.exists():
        raise FileExistsError(f"Файл уже существует: {args.output}. Выберите новое имя через --output.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(prepared, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Подготовлено: {len(set(row['clientCode'] for row in prepared))} клиентов, {len(prepared)} роутеров. {args.output}")
