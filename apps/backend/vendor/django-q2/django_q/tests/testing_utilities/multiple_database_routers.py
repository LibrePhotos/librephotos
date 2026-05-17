class TestingReplicaDatabaseRouter:
    """
    A router to control all database operations on models in the
    auth application.
    """

    def db_for_read(self, model, **hints):
        """
        Allows read access from REPLICA database.
        """
        return "replica"

    def db_for_write(self, model, **hints):
        """
        Always write to WRITABLE database
        """
        return "writable"


class TestingMultipleAppsDatabaseRouter:
    """
    A router to control all database operations on models in the
    auth application.
    """

    @staticmethod
    def is_admin(model):
        return model._meta.app_label in ["admin"]

    def db_for_read(self, model, **hints):
        if self.is_admin(model):
            return "admin"
        return "default"

    def db_for_write(self, model, **hints):
        if self.is_admin(model):
            return "admin"
        return "default"
