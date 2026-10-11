"""Independent development reference for validating the JavaScript migration."""
import struct


def u2(data, offset):
    return struct.unpack_from(">H", data, offset)[0]


def u4(data, offset):
    return struct.unpack_from(">I", data, offset)[0]


def constant_pool(data):
    count, offset, entries = u2(data, 8), 10, [None]
    while len(entries) < count:
        tag = data[offset]
        offset += 1
        if tag == 1:
            length = u2(data, offset)
            entries.append((tag, data[offset + 2:offset + 2 + length]))
            offset += 2 + length
        elif tag in (7, 8, 16, 19, 20):
            entries.append((tag, u2(data, offset)))
            offset += 2
        elif tag in (9, 10, 11, 12, 17, 18):
            entries.append((tag, u2(data, offset), u2(data, offset + 2)))
            offset += 4
        elif tag in (3, 4):
            entries.append((tag,))
            offset += 4
        elif tag in (5, 6):
            entries.extend(((tag,), None))
            offset += 8
        elif tag == 15:
            entries.append((tag,))
            offset += 3
        else:
            raise ValueError(f"Unknown constant-pool tag {tag}")
    return entries, offset


def attributes(data, offset):
    count = u2(data, offset)
    offset += 2
    result = []
    for _ in range(count):
        name, length = u2(data, offset), u4(data, offset + 2)
        result.append((name, offset + 6, length))
        offset += 6 + length
    return result, offset


def code_blocks(data, pool, offset):
    offset += 6  # access flags, this class, super class
    offset += 2 + u2(data, offset) * 2  # interfaces
    fields = u2(data, offset)
    offset += 2
    for _ in range(fields):
        _, offset = attributes(data, offset + 6)
    methods = u2(data, offset)
    offset += 2
    for _ in range(methods):
        attrs, offset = attributes(data, offset + 6)
        for name, start, _ in attrs:
            if pool[name] == (1, b"Code"):
                yield start + 8, u4(data, start + 4)


def instructions(data, start, length):
    end, cursor = start + length, start
    two = {0x10, 0x12, *range(0x15, 0x1A), *range(0x36, 0x3B), 0xA9, 0xBC}
    three = {0x11, 0x13, 0x14, 0x84, *range(0x99, 0xA9),
             *range(0xB2, 0xB9), 0xBB, 0xBD, 0xC0, 0xC1, 0xC6, 0xC7}
    five = {0xB9, 0xBA, 0xC8, 0xC9}
    while cursor < end:
        opcode = data[cursor]
        yield cursor, opcode
        if opcode in two:
            size = 2
        elif opcode in three:
            size = 3
        elif opcode in five:
            size = 5
        elif opcode == 0xC5:
            size = 4
        elif opcode == 0xC4:
            size = 6 if data[cursor + 1] == 0x84 else 4
        elif opcode in (0xAA, 0xAB):
            aligned = cursor + 1
            aligned += (-(aligned - start)) % 4
            if opcode == 0xAA:
                low, high = struct.unpack_from(">ii", data, aligned + 4)
                size = aligned - cursor + 12 + 4 * (high - low + 1)
            else:
                size = aligned - cursor + 8 + 8 * u4(data, aligned + 4)
        else:
            size = 1
        cursor += size
    if cursor != end:
        raise ValueError("Instruction parsing exceeded Code length")


def patch_socket_construction(original):
    pool, pool_end = constant_pool(original)
    socket_class = next(i for i, item in enumerate(pool)
                        if item and item[0] == 7 and pool[item[1]] == (1, b"java/net/Socket"))
    constructors = {i: item for i, item in enumerate(pool)
                    if item and item[0] == 10 and item[1] == socket_class
                    and pool[pool[item[2]][1]] == (1, b"<init>")}
    name = b"local/asobrain/BridgeSocket"
    new_name, new_class = len(pool), len(pool) + 1
    additions = bytearray(b"\x01" + struct.pack(">H", len(name)) + name)
    additions += b"\x07" + struct.pack(">H", new_name)
    new_constructors = {}
    for old_index, item in constructors.items():
        new_constructors[old_index] = len(pool) + 2 + len(new_constructors)
        additions += b"\x0a" + struct.pack(">HH", new_class, item[2])
    patched = bytearray(original)
    changes = {"new": 0, "constructor": 0}
    for start, length in code_blocks(original, pool, pool_end):
        for offset, opcode in instructions(original, start, length):
            if opcode == 0xBB and u2(original, offset + 1) == socket_class:
                struct.pack_into(">H", patched, offset + 1, new_class)
                changes["new"] += 1
            elif opcode == 0xB7 and u2(original, offset + 1) in new_constructors:
                struct.pack_into(">H", patched, offset + 1,
                                 new_constructors[u2(original, offset + 1)])
                changes["constructor"] += 1
    if changes != {"new": 1, "constructor": 1}:
        raise ValueError(f"Unexpected socket patch count: {changes}")
    count = len(pool) + 2 + len(new_constructors)
    return original[:8] + struct.pack(">H", count) + original[10:pool_end] + additions + patched[pool_end:]


def patch_graphics(original, component_owners=()):
    pool, pool_end = constant_pool(original)
    calls = [call for start, length in code_blocks(original, pool, pool_end)
             for call in instructions(original, start, length)]
    rectangular_clips = {
        offset for (offset, opcode), (following, next_opcode) in zip(calls, calls[1:])
        if opcode == 0xB6 and following == offset + 3 and next_opcode == 0xC0
        and pool[pool[u2(original, following + 1)][1]] == (1, b"java/awt/Rectangle")
    }
    clip_references = {u2(original, offset + 1) for offset in rectangular_clips}
    draws = {
        b"(Ljava/awt/Image;IILjava/awt/image/ImageObserver;)Z",
        b"(Ljava/awt/Image;IIIILjava/awt/image/ImageObserver;)Z",
        b"(Ljava/awt/Image;IIIIIIIILjava/awt/image/ImageObserver;)Z",
    }
    methods = {}
    for index, item in enumerate(pool):
        if not item or item[0] != 10:
            continue
        owner = pool[pool[item[1]][1]][1]
        name_and_type = pool[item[2]]
        name = pool[name_and_type[1]][1]
        descriptor = pool[name_and_type[2]][1]
        if owner == b"java/awt/Toolkit" and name == b"createImage" and descriptor == b"([B)Ljava/awt/Image;":
            methods[index] = (name, b"(Ljava/awt/Toolkit;" + descriptor[1:], "graphics")
        elif owner in (b"java/awt/Graphics", b"java/awt/Graphics2D") and name == b"drawImage" and descriptor in draws:
            methods[index] = (name, b"(Ljava/awt/Graphics;" + descriptor[1:], "graphics")
        elif name == b"createImage" and descriptor == b"(II)Ljava/awt/Image;" and owner in component_owners:
            methods[index] = (name, b"(Ljava/awt/Component;" + descriptor[1:], "graphics")
        elif owner in (b"java/awt/Graphics", b"java/awt/Graphics2D") and name == b"getClip" and descriptor == b"()Ljava/awt/Shape;" and index in clip_references:
            methods[index] = (b"getClipBounds", b"()Ljava/awt/Rectangle;", "clip")
    if not methods:
        return original, 0
    additions, next_index = bytearray(), len(pool)

    def add(tag, payload):
        nonlocal next_index
        index = next_index
        next_index += 1
        additions.extend(bytes((tag,)) + payload)
        return index

    def utf8(value):
        return add(1, struct.pack(">H", len(value)) + value)

    helper = None
    replacements = {}
    for index, (name, descriptor, kind) in methods.items():
        if kind == "graphics" and helper is None:
            helper = add(7, struct.pack(">H", utf8(b"local/asobrain/SmoothAssets")))
        name_index, descriptor_index = utf8(name), utf8(descriptor)
        name_and_type = add(12, struct.pack(">HH", name_index, descriptor_index))
        owner = pool[index][1] if kind == "clip" else helper
        replacements[index] = (add(10, struct.pack(">HH", owner, name_and_type)), kind)
    patched, changes = bytearray(original), 0
    for start, length in code_blocks(original, pool, pool_end):
        for offset, opcode in instructions(original, start, length):
            if opcode == 0xB6 and u2(original, offset + 1) in replacements:
                replacement, kind = replacements[u2(original, offset + 1)]
                if kind == "clip" and offset not in rectangular_clips:
                    continue
                if kind == "graphics":
                    patched[offset] = 0xB8  # Static helper receives the existing object as its first argument.
                struct.pack_into(">H", patched, offset + 1, replacement)
                changes += 1
    if not changes:
        return original, 0
    return original[:8] + struct.pack(">H", next_index) + original[10:pool_end] + additions + patched[pool_end:], changes
