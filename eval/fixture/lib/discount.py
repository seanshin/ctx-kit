def apply_discount(total, tier):
    if tier == "gold":
        return total * 0.8
    if tier == "silver":
        return total * 0.9
    return total
