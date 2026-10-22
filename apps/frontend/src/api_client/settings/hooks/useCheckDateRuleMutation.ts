import { endpoints, type DateTimeRule } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/**
 * Ask the server whether a rule from the rule form can be saved, as the settings save will check
 * it (#2272). Nothing is saved; the form shows a 400's messages next to their fields.
 */
export const useCheckDateRuleMutation = (options: MutationErrorOptions = {}) =>
  useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (rule: DateTimeRule) => endpoints.checkDateRule(apiClient, rule),
  });
