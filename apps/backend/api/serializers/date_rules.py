"""Request input and answers of the date rule views (#2272,
``api/views/date_rules.py``)."""

from rest_framework import serializers

APPLIES = "applies"
NOT_APPLICABLE = "not_applicable"
ERROR = "error"


class DateTagSerializer(serializers.Serializer[None]):
    name = serializers.CharField(help_text="The ExifTool tag, such as EXIF:CreateDate")
    utc = serializers.BooleanField(
        help_text="Its value is usually in UTC, so a rule on it converts the time"
    )


class DateRuleOptionsResponse(serializers.Serializer[None]):
    """What a custom date rule may use."""

    date_tags = DateTagSerializer(many=True, help_text="The tags a rule may read")
    condition_tags = serializers.ListField(
        child=serializers.CharField(),
        help_text="The tags an 'Only when the tag contains' condition may check",
    )
    first_custom_id = serializers.IntegerField(
        help_text="Custom rules take ids from here up"
    )


class DateRuleCheckRequest(serializers.Serializer[None]):
    rule = serializers.DictField(
        help_text="One date rule as datetime_rules holds it; a 400 names each "
        "of its params that cannot be saved as the error's field"
    )


class DateRuleCheckResponse(serializers.Serializer[None]):
    rule = serializers.DictField(help_text="The rule, which can be saved")


class DateRulesTestQuery(serializers.Serializer[None]):
    photo_id = serializers.UUIDField(help_text="One of the requester's own photos")


class RuleOutcomeSerializer(serializers.Serializer[None]):
    rule_id = serializers.IntegerField(
        allow_null=True, help_text="The rule's id; null when it has none"
    )
    name = serializers.CharField(help_text="The rule's name; empty when it has none")
    outcome = serializers.ChoiceField(
        choices=[APPLIES, NOT_APPLICABLE, ERROR],
        help_text="applies: the rule found a date; error: it could not run",
    )
    local_time = serializers.DateTimeField(
        allow_null=True,
        help_text="What it found: the local wall-clock time, tagged UTC like "
        "exif_timestamp",
    )
    utc_offset = serializers.IntegerField(
        allow_null=True, help_text="Minutes east of UTC, when the rule knows them"
    )
    error = serializers.CharField(allow_null=True, help_text="Why it could not run")


class DateRulesTestResponse(serializers.Serializer[None]):
    """What each of the requester's saved date rules reads from the photo's
    files now. Nothing is changed."""

    photo_id = serializers.UUIDField()
    exif_timestamp = serializers.DateTimeField(
        allow_null=True, help_text="The date the photo has now"
    )
    date_set_by_user = serializers.BooleanField(
        help_text="The date was set by hand, which wins over every rule"
    )
    winner = serializers.IntegerField(
        allow_null=True,
        help_text="The index in outcomes of the rule a scan takes the date "
        "from; null when none applies",
    )
    outcomes = RuleOutcomeSerializer(many=True, help_text="One per rule, in order")
