from orders import OrderService

service = OrderService()


def handle_order(req):
    return service.place_order(req["user"], req["item"], req["qty"])
