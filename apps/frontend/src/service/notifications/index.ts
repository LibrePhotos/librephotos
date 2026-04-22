import { albums } from "./albums";
import { auth } from "./auth";
import { faces } from "./faces";
import { people } from "./people";
import { photos } from "./photos";
import { services } from "./services";
import { user } from "./user";
import { worker } from "./worker";

export const notification = {
  ...albums,
  ...auth,
  ...faces,
  ...people,
  ...photos,
  ...services,
  ...user,
  ...worker,
};
