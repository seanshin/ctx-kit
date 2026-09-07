from discount import apply_discount
from users import UserStore


class OrderService:
    def __init__(self):
        self.users = UserStore()

    def place_order(self, user_id, item, qty):
        total = calc_total(item, qty)
        tier = self.users.get_tier(user_id)
        return apply_discount(total, tier)


def calc_total(item, qty):
    return item.price * qty
