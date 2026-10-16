import { albums } from "./albums";
import { auth } from "./auth";
import { faces } from "./faces";
import { moves } from "./moves";
import { people } from "./people";
import { photos } from "./photos";
import { services } from "./services";
import { tags } from "./tags";
import { toast } from "./toast";
import { user } from "./user";
import { worker } from "./worker";

export const notification = {
  ...albums,
  ...auth,
  ...faces,
  ...moves,
  ...people,
  ...photos,
  ...services,
  ...tags,
  ...user,
  ...worker,
  // For a message that has no named helper: success, warning, error and hide.
  ...toast,
};
