(function($) {
    'use strict';

    $(function() {

        $('#content-main').on('click', '.reset-link', function(e) {
            e.preventDefault();

            var field_selector = this.dataset.fieldId.replace(/ /g, "\\ ") 
            var field = $('#' + field_selector);
            var fieldType = this.dataset.fieldType;

            if (fieldType === 'checkbox') {
                field.prop('checked', this.dataset.default === 'true');
            } else if (fieldType === 'date') {
                var defaultDate = new Date(this.dataset.default * 1000);
                $('#' + this.dataset.fieldId).val(defaultDate.strftime(get_format('DATE_INPUT_FORMATS')[0]));
            } else if (fieldType === 'datetime') {
                var defaultDate = new Date(this.dataset.default * 1000);
                $('#' + this.dataset.fieldId + '_0').val(defaultDate.strftime(get_format('DATE_INPUT_FORMATS')[0]));
                $('#' + this.dataset.fieldId + '_1').val(defaultDate.strftime(get_format('TIME_INPUT_FORMATS')[0]));
            } else {
                field.val(this.dataset.default);
            }
        });
    });
})(django.jQuery);
