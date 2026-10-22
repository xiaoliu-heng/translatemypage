import Foundation
import Security

// Secrets only travel on stdin/stdout; neither shell arguments nor diagnostics contain them.
do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let request = try JSONSerialization.jsonObject(with: input) as? [String: String],
          let service = request["service"], let key = request["key"], let action = request["action"],
          service.hasPrefix("com.translatemypage.") else { exit(2) }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                              kSecAttrService as String: service, kSecAttrAccount as String: key]
    var result: [String: String] = [:]
    switch action {
    case "get":
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &found)
        if status == errSecSuccess, let data = found as? Data, let value = String(data: data, encoding: .utf8) {
            result["value"] = value
        } else if status != errSecItemNotFound { exit(3) }
    case "set":
        guard let value = request["value"]?.data(using: .utf8) else { exit(2) }
        let update = [kSecValueData as String: value]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = value
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        if status != errSecSuccess { exit(3) }
    case "delete":
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound { exit(3) }
    default: exit(2)
    }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
} catch { exit(2) }
