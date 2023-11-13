import { IUser } from "../../store/user/user.zod";

function fuzzyMatch(str: string, pattern: string) {
  if (pattern.split("").length > 0) {
    const expr = pattern.split("").reduce((a, b) => `${a}.*${b}`);
    return new RegExp(expr).test(str);
  }
  return false;
}

export default function filterUsers(username: string, excludeUserId: number, users: IUser[] = []): IUser[] {
  return users
    .filter(user => {
      if (username.length === 0) {
        return true;
      }
      return (
        fuzzyMatch(user.username.toLowerCase(), username.toLowerCase()) ||
        fuzzyMatch(`${user.first_name.toLowerCase()} ${user.last_name.toLowerCase()}`, username.toLowerCase())
      );
    })
    .filter(user => user.id !== excludeUserId);
}
