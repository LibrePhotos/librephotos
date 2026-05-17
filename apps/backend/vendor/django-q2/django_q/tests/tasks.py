from time import sleep


class TaskError(Exception):
    pass


def countdown(n):
    while n > 0:
        n -= 1


def multiply(x, y):
    return x * y


def count_letters(tup):
    total = 0
    for word in tup:
        total += len(word)
    return total


def count_letters2(obj):
    return count_letters(obj.get_words())


def word_multiply(x, word=""):
    return len(word) * x


def count_forever():
    while True:
        sleep(0.5)


def get_task_name(task):
    return task.name


def get_user_id(user):
    return user.id


def hello():
    return "hello"


def return_falsy_value():
    return []


def result(obj):
    print(f"RESULT HOOK {obj.name} : {obj.result()}")


def raise_exception():
    raise TaskError("this is an exception!")
