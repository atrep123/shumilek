def generate(model_path):
    # Implementace generování textu z Markovova řetězce
    with open(model_path, 'r') as file:
        model = json.load(file)
    
    if not model:
        return None
    
    first_char = random.choice(list(model.keys()))
    text = first_char
    current_char = first_char
    while True:
        next_chars = model[current_char]
        if not next_chars:
            break
        next_char = random.choice(next_chars)
        text += next_char
        current_char = next_char
    return text
