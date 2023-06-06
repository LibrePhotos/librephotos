import csv
from datetime import datetime, timedelta
from random import randint, randrange


def generate_csv_data(file_path):
    with open(file_path, "w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        countries = [
            "Canada",
            "Australia",
            "Germany",
            "France",
            "Canada",
            "France",
            "Japan",
            "China",
        ]
        start_date = datetime(2018, 1, 1)
        end_date = datetime(2022, 12, 31)
        days = (end_date - start_date).days
        base = int(days / len(countries))
        entries = []
        for index, country in enumerate(countries):
            timestamp = start_date + timedelta(
                days=randint(base * (index + 1), base * (index + 2))
            )
            for _ in range(randint(10, 30)):
                timestamp = timestamp.replace(
                    hour=randrange(24), minute=randrange(60), second=randrange(60)
                )
                entries.append([country, timestamp])

        entries.sort(key=lambda x: x[1])  # Sort by timestamp

        for entry in entries:
            writer.writerow(
                [entry[0], entry[1].strftime("%Y-%m-%d %H:%M:%S.000000 +00:00")]
            )


generate_csv_data("fixture.csv")
