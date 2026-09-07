class UserStore:
    def __init__(self):
        self._tiers = {}

    def get_tier(self, user_id):
        return self._tiers.get(user_id, "basic")
